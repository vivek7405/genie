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
import { nextSystemStatus } from '#modules/tasks/utils/state-machine.ts';
import { commentMarker, commentOnIssue, readIssue } from '#modules/github/issues.server.ts';
import { findPreviewUrl } from '#modules/github/pr.server.ts';
import { createTaskMachine, execLong, readFile, type ExecOptions, type ExecResult } from './pilots.server.ts';
import { runClaude, type ClaudeRun, type RunClaudeOptions } from './claude.server.ts';
import { cloneRepo, pushBranch } from './git.server.ts';
import { recordEvent } from './events.server.ts';
import { renderPrompt, slugify } from './prompts.server.ts';

export const APP_DIR = '/home/pilot/app';
export const PLAN_PATH = '/home/pilot/PLAN.md';
export const AGENT_LOG = '/home/pilot/agent.log';
const PLAN_TIMEOUT_MS = 180_000;
const PLAN_MAX_TURNS = 12;
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
    // in_progress still advances without work; the next commit replaces it
    // with the real build stage.
    default: return nextSystemStatus(task.status);
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
