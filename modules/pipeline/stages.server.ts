// Server-only: the work each system-owned stage does. The worker knows one
// function, runStage(task), which dispatches on the task's status:
//
//   todo         ensureMachine   a Pilots machine with the repo cloned
//   planning     plan            one timeboxed Claude run writes PLAN.md
//   in_progress  build           a long Claude run on a branch, then the PR,
//                                a self-review, and the preview URL
//
// Every stage is safe to run twice on the same row (a stale claim, a restart
// that cleared claimedAt): the machine is reused when it still answers, the
// branch is reused when set, an open PR is looked up before Claude runs, and
// the plan comment is posted only once. Every side effect on the outside
// world (Pilots, Claude, git, GitHub) goes through `deps`, whose defaults are
// the real modules and whose test seam is setStageDeps().
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Project, Task } from '#db/schema.server.ts';
import type { TaskStatus } from '#modules/tasks/types.ts';
import { commentMarker, commentOnIssue, readIssue } from '#modules/github/issues.server.ts';
import { findPreviewUrl } from '#modules/github/pr.server.ts';
import { createTaskMachine, execLong, readFile, shellQuote, type ExecOptions, type ExecResult } from './pilots.server.ts';
import { runClaude, type ClaudeRun, type RunClaudeOptions } from './claude.server.ts';
import { cloneRepo, gitEnv, pushBranch } from './git.server.ts';
import { recordEvent } from './events.server.ts';
import { renderPrompt, slugify } from './prompts.server.ts';

export const APP_DIR = '/home/pilot/app';
export const PLAN_PATH = '/home/pilot/PLAN.md';
export const AGENT_LOG = '/home/pilot/agent.log';
const PLAN_TIMEOUT_MS = 180_000;
const PLAN_MAX_TURNS = 12;
const BUILD_TIMEOUT_MS = Number(process.env.GENIE_BUILD_TIMEOUT_MS ?? 2_700_000);
const BUILD_MAX_TURNS = 200;
const SELF_REVIEW_TIMEOUT_MS = 600_000;
const SELF_REVIEW_MAX_TURNS = 60;
const PR_BODY_PATH = '/home/pilot/pr-body.md';
const APP_PORT = 8080;
// A repository with none of these and fewer than EMPTY_REPO_MAX_FILES tracked
// files has no application code: a README, LICENSE, .gitignore and a
// workflow still count as empty.
const MANIFESTS = ['package.json', 'go.mod', 'Gemfile', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'mix.exs', 'Package.swift', 'deno.json'];
const EMPTY_REPO_MAX_FILES = 5;
export const SCAFFOLD_CMD = 'npm create webjs@latest scaffold -- --db sqlite --runtime node';

export interface StageTiming {
  // Poll cadences. Tests set these to 0 so a loop runs its iterations
  // without waiting.
  logPollMs: number;
  previewPollMs: number;
  appPollMs: number;
  // Windows. Tests shorten them to force the fallback paths.
  previewTimeoutMs: number;
  appStartTimeoutMs: number;
}

export interface StageDeps {
  createTaskMachine: (task: Task, project: Project) => Promise<{ id: string; name: string; url: string }>;
  execLong: (machineId: string, cmd: string, opts: ExecOptions) => Promise<ExecResult>;
  readFile: (machineId: string, path: string) => Promise<string>;
  runClaude: (machineId: string, opts: RunClaudeOptions) => Promise<ClaudeRun>;
  cloneRepo: (machineId: string, project: Project, opts: { dir: string }) => Promise<void>;
  pushBranch: (machineId: string, dir: string, branch: string) => Promise<void>;
  commentOnIssue: (project: Project, issueNumber: number, body: string) => Promise<unknown>;
  readIssue: (project: Project, issueNumber: number) => Promise<{ title: string; body: string }>;
  findPreviewUrl: (project: Project, prNumber: number, opts: { sha: string }) => Promise<string | null>;
  timing: StageTiming;
  // The public URL of a task machine, for the preview fallback.
  machineUrl: (name: string) => string;
}

const defaults: StageDeps = {
  createTaskMachine, execLong, readFile, runClaude, cloneRepo, pushBranch, commentOnIssue, readIssue, findPreviewUrl,
  timing: {
    logPollMs: 5_000,
    previewPollMs: 15_000,
    appPollMs: 5_000,
    previewTimeoutMs: Number(process.env.GENIE_PREVIEW_TIMEOUT_MS ?? 600_000),
    appStartTimeoutMs: 120_000,
  },
  machineUrl: (name) => `https://${name}${process.env.PILOTS_URL_SUFFIX ?? '.pilotrun.app'}`,
};
let deps: StageDeps = { ...defaults };

// Test seam: swap any dependency, get a restore function back.
export function setStageDeps(patch: Partial<StageDeps>): () => void {
  const before = deps;
  deps = { ...deps, ...patch, timing: { ...deps.timing, ...(patch.timing ?? {}) } };
  return () => { deps = before; };
}

// Returns the status the task should move to once this stage is complete, or
// null when the task's current status has no system-owned successor.
export async function runStage(task: Task): Promise<TaskStatus | null> {
  const project = await db.query.projects.findFirst({ where: { id: task.projectId } });
  if (!project) throw new Error('Task has no project.');
  switch (task.status) {
    case 'todo': return ensureMachine(task, project);
    case 'planning': return plan(task, project);
    case 'in_progress': return build(task, project);
    default: return null;
  }
}

// Rate-limit signal for #6. In M4 the worker treats it like any failure.
export class RateLimitedError extends Error {
  resetsAt: Date | null;
  constructor(resetsAt: Date | null = null) {
    super(resetsAt ? `Claude is rate limited until ${resetsAt.toISOString()}` : 'Claude is rate limited.');
    this.name = 'RateLimitedError';
    this.resetsAt = resetsAt;
  }
}

async function patchTask(id: string, patch: Partial<Task>): Promise<Task> {
  const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
  return row;
}

export function branchFor(task: Pick<Task, 'id' | 'title' | 'githubIssueNumber'>): string {
  const key = task.githubIssueNumber ?? task.id.slice(0, 8);
  return `genie/${key}-${slugify(task.title)}`;
}

function requireMachine(task: Task): string {
  if (!task.machineId) throw new Error('Task has no machine. Retry from Todo.');
  return task.machineId;
}

// Every Claude run goes through here so the rate-limit check lives once.
async function claude(machineId: string, opts: RunClaudeOptions): Promise<ClaudeRun> {
  const r = await deps.runClaude(machineId, opts);
  if (r.isRateLimited) throw new RateLimitedError(r.resetsAt ?? null);
  return r;
}

// The task text the prompts see. The issue wins when the task is synced: a
// human may have edited it on GitHub since the row was created.
async function taskText(task: Task, project: Project): Promise<{ issueRef: string; title: string; description: string }> {
  if (task.githubIssueNumber) {
    const issue = await deps.readIssue(project, task.githubIssueNumber);
    return { issueRef: `Issue #${task.githubIssueNumber}`, title: issue.title || task.title, description: issue.body || task.description || '(no description)' };
  }
  return { issueRef: 'Task', title: task.title, description: task.description || '(no description)' };
}

// An empty repository has no application code: no package manifest and only
// a handful of tracked files. A probe that cannot be read is treated as a
// repository with code, the branch that never scaffolds over anything.
export async function isEmptyRepo(machineId: string): Promise<boolean> {
  const r = await deps.execLong(machineId,
    `cd ${APP_DIR} && (ls ${MANIFESTS.join(' ')} 2>/dev/null | wc -l) && (git ls-files | wc -l)`,
    { timeoutMs: 30_000 });
  const [manifests, files] = r.stdout.trim().split('\n').map((s) => Number(s.trim()));
  if (!Number.isFinite(manifests) || !Number.isFinite(files)) return false;
  return manifests === 0 && files < EMPTY_REPO_MAX_FILES;
}

// The prompt paragraph that tells the agent what the probe found.
function stackNote(empty: boolean, branch: string): string {
  return empty
    ? `This repository has no application code (no package manifest, fewer than ${EMPTY_REPO_MAX_FILES} tracked files). Genie scaffolds a WebJs app at the repository root (\`${SCAFFOLD_CMD}\`, then \`npm run gallery:clear\`) and commits it as the first commit on \`${branch}\` before the build starts. The Stack line is therefore \`empty-repo-webjs\`.`
    : 'This repository already has code. The Stack line is `new-app-webjs: <dir>` only if the task asks for a new web application, otherwise `existing: <stack>`.';
}

export type StackChoice = { kind: 'empty-repo-webjs' } | { kind: 'new-app-webjs'; dir: string } | { kind: 'existing'; stack: string };

// The plan's `## Stack` line. Missing or malformed means the safe default:
// the existing stack, at the repository root.
export function stackFromPlan(plan: string | null): StackChoice {
  const m = /^## Stack[ \t]*\n+[ \t]*(.+?)[ \t]*$/m.exec(plan ?? '');
  const line = (m?.[1] ?? '').replace(/`/g, '').trim();
  if (line === 'empty-repo-webjs') return { kind: 'empty-repo-webjs' };
  const app = /^new-app-webjs:\s*([\w./-]+)$/.exec(line);
  if (app) return { kind: 'new-app-webjs', dir: app[1].replace(/^\.?\/+|\/+$/g, '') };
  const ex = /^existing:\s*(.+)$/.exec(line);
  return { kind: 'existing', stack: ex?.[1] ?? 'unknown' };
}

// Where the app to serve lives inside the clone.
export function appDirOf(task: Pick<Task, 'plan'>): string {
  const choice = stackFromPlan(task.plan);
  return choice.kind === 'new-app-webjs' ? `${APP_DIR}/${choice.dir}` : APP_DIR;
}

// Stage 2, planning to in_progress: one timeboxed run writes PLAN.md outside
// the repository, so it can never be committed. The timebox may cut the run
// short and that is fine: the file is what matters, and only a missing file
// fails the stage. A re-run overwrites the file and posts the comment only
// if the row still had no plan.
export async function plan(task: Task, project: Project): Promise<TaskStatus> {
  const machineId = requireMachine(task);
  const text = await taskText(task, project);
  const branch = task.branch ?? branchFor(task);
  const empty = await isEmptyRepo(machineId);
  const prompt = renderPrompt('plan', {
    ...text, repo: project.githubRepo, appDir: APP_DIR, planPath: PLAN_PATH, maxTurns: String(PLAN_MAX_TURNS), stackNote: stackNote(empty, branch),
  });
  await recordEvent(task.id, 'log', 'Planning (timeboxed to 3 minutes)');
  await claude(machineId, { prompt, cwd: APP_DIR, timeoutMs: PLAN_TIMEOUT_MS, maxTurns: PLAN_MAX_TURNS, logPath: AGENT_LOG });
  const planText = (await deps.readFile(machineId, PLAN_PATH).catch(() => '')).trim();
  if (!planText) throw new Error('Planning produced no PLAN.md within the timebox.');
  await patchTask(task.id, { plan: planText });
  if (task.githubIssueNumber && !task.plan) {
    await deps.commentOnIssue(project, task.githubIssueNumber, `${commentMarker('plan')}\n## Genie plan\n\n${planText}`);
    await recordEvent(task.id, 'github', `Plan posted on issue #${task.githubIssueNumber}`);
  }
  return 'in_progress';
}

// Stage 1, todo to planning: a machine that holds a clone of the repository.
// A re-claim after a crash keeps the machine if it still answers a probe,
// and skips the clone if the probe found one.
export async function ensureMachine(task: Task, project: Project): Promise<TaskStatus> {
  let machineId = task.machineId;
  let cloned = false;
  if (machineId) {
    const probe = await deps.execLong(machineId, `test -d ${APP_DIR}/.git && echo ok`, { timeoutMs: 30_000 }).catch(() => null);
    cloned = probe?.stdout.trim() === 'ok';
    if (!probe) machineId = null;
  }
  if (!machineId) {
    const m = await deps.createTaskMachine(task, project);
    machineId = m.id;
    await patchTask(task.id, { machineId: m.id, machineName: m.name });
    await recordEvent(task.id, 'log', `Machine ${m.name} ready`);
  }
  if (!cloned) {
    await deps.cloneRepo(machineId, project, { dir: APP_DIR });
    await recordEvent(task.id, 'log', `Cloned ${project.githubRepo} into ${APP_DIR}`);
  }
  return 'planning';
}

// The env that lets gh in the machine reach GitHub. Empty when no token is
// configured, in which case gh answers with its own error and the stage
// reports it.
function ghEnv(): Record<string, string> {
  const token = process.env.GH_TOKEN;
  return token ? gitEnv(token) : {};
}

// #5 branches here on task.feedback to pick prompts/revise.md and to read
// deps for the same-branch push. M4 always builds.
export function buildOrRevise(_task: Task, _deps: StageDeps): 'build' {
  return 'build';
}

// Genie scaffolds deterministically: the scaffold is a build-stage
// deliverable, not something the agent should improvise. The repository's
// own README survives the copy; everything else the scaffold ships wins,
// its .gitignore included, so node_modules never reaches the commit.
async function scaffoldWebjs(task: Task, machineId: string, branch: string, defaultBranch: string): Promise<void> {
  await recordEvent(task.id, 'log', 'Empty repository: scaffolding a WebJs app (sqlite, node) at the root');
  const cmd = [
    `cd /home/pilot && rm -rf scaffold && ${SCAFFOLD_CMD}`,
    `rm -rf scaffold/.git && ([ ! -f ${APP_DIR}/README.md ] || rm -f scaffold/README.md) && cp -a scaffold/. ${APP_DIR}/ && rm -rf scaffold`,
    `cd ${APP_DIR} && npm install --no-audit --no-fund && npm run gallery:clear`,
    `git checkout ${shellQuote(defaultBranch)} && (git checkout -b ${shellQuote(branch)} || git checkout ${shellQuote(branch)})`,
    `git add -A && git commit -m "Scaffold a webjs app"`,
  ].join(' && ');
  const r = await deps.execLong(machineId, cmd, { cwd: APP_DIR, timeoutMs: 900_000 });
  if (r.exitCode !== 0) throw new Error(`Scaffolding failed: ${(r.stderr.trim() || r.stdout.trim()).slice(-500)}`);
  await recordEvent(task.id, 'log', `Scaffold committed on ${branch}`);
}

// Stage 3, in_progress to ready_for_review: one long run implements the
// plan on the task branch, commits per unit, pushes and opens the PR. Genie
// then resolves the PR itself with gh instead of parsing the agent's output,
// opens it when the run ended before that step, and waits for the preview.
// A re-claim reuses the branch and never opens a second PR: an open one is
// looked up before Claude runs at all.
export async function build(task: Task, project: Project): Promise<TaskStatus> {
  const machineId = requireMachine(task);
  const branch = task.branch ?? branchFor(task);
  if (!task.branch) await patchTask(task.id, { branch });
  let pr = task.prNumber && task.prUrl ? { number: task.prNumber, url: task.prUrl } : await findOpenPr(machineId, branch);
  if (!pr) {
    const text = await taskText(task, project);
    const closesLine = task.githubIssueNumber ? `Closes #${task.githubIssueNumber}` : `Task: ${task.title}`;
    const empty = await isEmptyRepo(machineId);
    if (empty) await scaffoldWebjs(task, machineId, branch, project.defaultBranch);
    const prompt = renderPrompt(buildOrRevise(task, deps), {
      ...text, repo: project.githubRepo, appDir: APP_DIR, planPath: PLAN_PATH, plan: task.plan ?? '(no plan, work from the task text)',
      branch, defaultBranch: project.defaultBranch, closesLine, stackNote: stackNote(empty, branch),
    });
    await recordEvent(task.id, 'log', `Building on ${branch}`);
    await claude(machineId, { prompt, cwd: APP_DIR, timeoutMs: BUILD_TIMEOUT_MS, maxTurns: BUILD_MAX_TURNS, logPath: AGENT_LOG });
    pr = (await findOpenPr(machineId, branch)) ?? (await openPrBackstop(task, project, machineId, branch, closesLine));
  }
  await patchTask(task.id, { prNumber: pr.number, prUrl: pr.url });
  await recordEvent(task.id, 'github', `Pull request #${pr.number} ${pr.url}`);
  // A re-claim that already had the PR was reviewed by the attempt that
  // opened it; reviewing again would post the comments twice.
  if (!task.prNumber && selfReviewEnabled()) await selfReview(task, machineId, branch, pr.number);
  const sha = await headSha(machineId, branch);
  const previewUrl = await awaitPreview(task, project, machineId, pr.number, sha);
  await patchTask(task.id, { previewUrl });
  return 'ready_for_review';
}

export function selfReviewEnabled(): boolean {
  return process.env.GENIE_SELF_REVIEW !== '0';
}

// The counts in the run's free-form summary, best effort: "Fixed 2
// findings and left 3 comments" or "3 inline comments posted, 2 issues
// applied". A count that cannot be read is 0.
export function parseSelfReview(text: string): { fixed: number; comments: number } {
  const first = (patterns: RegExp[]): number => {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) return Number(m[1]);
    }
    return 0;
  };
  const fixed = first([
    /(\d+)\s+(?:findings?|issues?|fixes|problems?)\b[^.\n]*?\b(?:fixed|applied|resolved|addressed)/i,
    /\b(?:fixed|applied|resolved|addressed)\s+(?:all\s+)?(\d+)/i,
  ]);
  const comments = first([
    /(\d+)\s+(?:inline\s+|review\s+|new\s+)?comments?/i,
    /\b(?:posted|left)\s+(\d+)/i,
  ]);
  return { fixed, comments };
}

// Claude Code's own code-review skill, run on the PR from the same branch:
// it fixes the findings in the working tree, commits, pushes, and posts the
// comments through gh. The PR exists whatever happens here, so nothing in
// this function fails the stage: a bad exit, a rate limit or a thrown run
// becomes a feed line and the task proceeds. Genie then commits any tracked
// change the skill left unstaged and pushes, so the sha the preview waits
// for is the reviewed code.
async function selfReview(task: Task, machineId: string, branch: string, prNumber: number): Promise<void> {
  await recordEvent(task.id, 'log', `Self-review of pull request #${prNumber} (timeboxed to 10 minutes)`);
  let run: ClaudeRun;
  try {
    run = await deps.runClaude(machineId, {
      prompt: `/code-review --fix --comment ${prNumber}`, cwd: APP_DIR, timeoutMs: SELF_REVIEW_TIMEOUT_MS, maxTurns: SELF_REVIEW_MAX_TURNS, logPath: AGENT_LOG,
    });
  } catch (err) {
    await recordEvent(task.id, 'log', `Self-review skipped: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (run.isRateLimited) {
    await recordEvent(task.id, 'log', 'Self-review skipped: Claude is rate limited');
    return;
  }
  const { fixed, comments } = parseSelfReview(run.result);
  const suffix = run.exitCode === 0 ? '' : ` (the run ended with exit ${run.exitCode})`;
  await recordEvent(task.id, 'log', `Self-review: ${fixed} findings fixed, ${comments} comments left${suffix}`);
  try {
    const commit = await deps.execLong(machineId,
      `git diff --quiet HEAD -- . || (git add -u && git commit -q -m "Apply the self-review findings" && echo committed)`,
      { cwd: APP_DIR, timeoutMs: 60_000 });
    if (commit.stdout.includes('committed')) await recordEvent(task.id, 'log', 'Committed the self-review fixes the run left in the working tree');
    await deps.pushBranch(machineId, APP_DIR, branch);
  } catch (err) {
    await recordEvent(task.id, 'log', `Self-review push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The pushed head, so the preview poll only accepts a preview of this
// round's commit (a revise round in #5 would otherwise see the old one).
export async function headSha(machineId: string, branch: string): Promise<string> {
  const r = await deps.execLong(machineId, `git rev-parse origin/${shellQuote(branch)}`, { cwd: APP_DIR, timeoutMs: 30_000 });
  const sha = r.stdout.trim();
  if (r.exitCode !== 0 || !sha) throw new Error(`Branch ${branch} is not on the remote.`);
  return sha;
}

async function findOpenPr(machineId: string, branch: string): Promise<{ number: number; url: string } | null> {
  const r = await deps.execLong(machineId, `gh pr list --head ${shellQuote(branch)} --state open --json number,url --limit 1`, { cwd: APP_DIR, env: ghEnv(), timeoutMs: 60_000 });
  if (r.exitCode !== 0) return null;
  try {
    const list = JSON.parse(r.stdout || '[]') as { number: number; url: string }[];
    return list[0] ?? null;
  } catch {
    return null;
  }
}

// The agent ran out of turns or time before the PR step. Push what it
// committed and open the PR ourselves; a PR with a thin body beats none.
async function openPrBackstop(task: Task, project: Project, machineId: string, branch: string, closesLine: string): Promise<{ number: number; url: string }> {
  const has = await deps.execLong(machineId, `git rev-parse --verify ${shellQuote(branch)}`, { cwd: APP_DIR, timeoutMs: 30_000 });
  if (has.exitCode !== 0) throw new Error(`The build produced no branch ${branch}.`);
  await deps.pushBranch(machineId, APP_DIR, branch);
  const body = `${closesLine}\n\nOpened by Genie after the build run ended before its own PR step. Review the commits on ${branch}.`;
  const r = await deps.execLong(machineId,
    `printf '%s' ${shellQuote(body)} > ${PR_BODY_PATH} && gh pr create --base ${shellQuote(project.defaultBranch)} --head ${shellQuote(branch)} --title ${shellQuote(task.title.slice(0, 70))} --body-file ${PR_BODY_PATH}`,
    { cwd: APP_DIR, env: ghEnv(), timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error(`gh pr create failed: ${r.stderr.trim()}`);
  const pr = await findOpenPr(machineId, branch);
  if (!pr) throw new Error('The pull request was created but gh pr list cannot find it.');
  await recordEvent(task.id, 'log', "Opened the pull request on the agent's behalf");
  return pr;
}

async function awaitPreview(task: Task, project: Project, machineId: string, prNumber: number, sha: string): Promise<string> {
  await recordEvent(task.id, 'log', `Waiting for the Pilots preview of ${sha.slice(0, 7)} on the pull request`);
  const deadline = Date.now() + deps.timing.previewTimeoutMs;
  do {
    const url = await deps.findPreviewUrl(project, prNumber, { sha });
    if (url) return url;
    await sleep(deps.timing.previewPollMs);
  } while (Date.now() < deadline);
  return startAppFallback(task, machineId);
}

// The repo is not connected to Pilots, so nothing will ever comment. Serve
// the branch from the task machine instead, and say so.
async function startAppFallback(task: Task, machineId: string): Promise<string> {
  const name = task.machineName;
  if (!name) throw new Error('No preview appeared and the task has no machine name to fall back to.');
  const minutes = Math.round(deps.timing.previewTimeoutMs / 60_000);
  await recordEvent(task.id, 'log', `No Pilots preview after ${minutes} minutes. Connect the repo to Pilots (pilot repo connect) to get PR previews. Starting the app in the task machine instead.`);
  const dir = appDirOf(task);
  await deps.execLong(machineId,
    `cd ${dir} && (npm install --no-audit --no-fund >/home/pilot/app.log 2>&1 || true) && setsid nohup sh -c 'PORT=${APP_PORT} npm run start 2>&1 || PORT=${APP_PORT} npm run dev 2>&1' >> /home/pilot/app.log 2>&1 < /dev/null &`,
    { cwd: dir, timeoutMs: 600_000 });
  const deadline = Date.now() + deps.timing.appStartTimeoutMs;
  do {
    const r = await deps.execLong(machineId,
      `node -e "fetch('http://127.0.0.1:${APP_PORT}/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"`, { timeoutMs: 15_000 });
    if (r.exitCode === 0) return deps.machineUrl(name);
    await sleep(deps.timing.appPollMs);
  } while (Date.now() < deadline);
  throw new Error(`No Pilots preview appeared and the app did not start on port ${APP_PORT} in the task machine (see /home/pilot/app.log).`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
