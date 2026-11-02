// Server-only: the work each worker-owned column does.
//
//   backlog      prepare         a Pilots machine with the repo cloned
//   in_progress  build           one Claude run plans, builds, pushes, opens the PR
//                revise          when the row carries feedback: a run on the same
//                                branch and pull request
//                settle          after either: wait for CI, fix it if it fails, and
//                                find or start a preview
//
// Every stage is safe to run twice on the same row (a restart, a Retry): the
// machine and branch are reused and an open PR is looked up before Claude runs.
// Every side effect goes through `deps`, the test seam.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Project, Task } from '#db/schema.server.ts';
import type { TaskStatus } from '#modules/tasks/types.ts';
import { findPilotsPreview, readChecks, type CheckSummary } from '#modules/github/checks.server.ts';
import { findOpenPr, openPr, readHeadSha, type PrRef } from '#modules/github/pr.server.ts';
import { runClaude, type ClaudeRun, type RunClaudeOptions } from './claude.server.ts';
import { recordEvent, notifyBoard } from './events.server.ts';
import { APP_DIR, cloneRepo, pushBranch } from './git.server.ts';
import { createTaskMachine, execLong, machineUrl, repoHasService, shellQuote, type ExecOptions, type ExecResult } from './pilots.server.ts';
import { renderPrompt, slugify } from './prompts.server.ts';

export const AGENT_LOG = '/home/pilot/agent.log';
const BUILD_TIMEOUT_MS = 45 * 60_000;
const BUILD_MAX_TURNS = 200;
const REVISE_TIMEOUT_MS = 30 * 60_000;
const REVISE_MAX_TURNS = 120;
const FIX_CI_TIMEOUT_MS = 20 * 60_000;
const FIX_CI_MAX_TURNS = 80;
// How many times a run may try to turn red CI green before a person decides.
export const MAX_CI_FIXES = 3;
const PREVIEW_PORT = 8080;
const LOG_LINE_MAX = 240;
const LOG_BATCH_LINES = 200;
// Tool results can make a stream-json line huge. The feed only reads assistant
// lines, so a truncated line that no longer parses loses nothing it wanted.
const LOG_LINE_BYTES = 200_000;

export interface StageDeps {
  createTaskMachine: (task: Task, project: Project) => Promise<{ id: string; name: string }>;
  execLong: (machineId: string, cmd: string, opts: ExecOptions) => Promise<ExecResult>;
  runClaude: (machineId: string, opts: RunClaudeOptions) => Promise<ClaudeRun>;
  cloneRepo: (machineId: string, repo: string, branch: string) => Promise<void>;
  pushBranch: (machineId: string, branch: string) => Promise<void>;
  findOpenPr: (repo: string, branch: string) => Promise<PrRef | null>;
  openPr: typeof openPr;
  readHeadSha: (repo: string, prNumber: number) => Promise<string>;
  readChecks: (repo: string, sha: string) => Promise<CheckSummary>;
  repoHasService: (repo: string) => Promise<boolean>;
  findPilotsPreview: (repo: string, prNumber: number, sha: string) => Promise<string | null>;
  machineUrl: (machineId: string) => Promise<string>;
  logPollMs: number;
  timing: {
    pollMs: number;
    // Checks that have not appeared by now are not coming.
    checksAppearMs: number;
    checksFinishMs: number;
    pilotsPreviewMs: number;
    appStartMs: number;
  };
}

const defaults: StageDeps = {
  createTaskMachine, execLong, runClaude, cloneRepo, pushBranch, findOpenPr, openPr, readHeadSha, readChecks, repoHasService, findPilotsPreview, machineUrl,
  logPollMs: 4_000,
  timing: { pollMs: 15_000, checksAppearMs: 2 * 60_000, checksFinishMs: 20 * 60_000, pilotsPreviewMs: 10 * 60_000, appStartMs: 2 * 60_000 },
};
let deps: StageDeps = { ...defaults };

// Test seam: swap any dependency, get a restore function back.
export function setStageDeps(patch: Partial<StageDeps>): () => void {
  const before = deps;
  deps = { ...deps, ...patch };
  return () => { deps = before; };
}

// The column the task moves to when this stage completes, or null.
export async function runStage(task: Task): Promise<TaskStatus | null> {
  const project = await db.query.projects.findFirst({ where: { id: task.projectId } });
  if (!project) throw new Error('This task has no project.');
  if (task.status === 'backlog') {
    await prepare(task, project);
    return 'in_progress';
  }
  if (task.status === 'in_progress') {
    const machineId = await prepare(task, project);
    const pr = await (task.feedback ? revise(task, project, machineId) : build(task, project, machineId));
    await settle(task, project, machineId, pr);
    return 'review';
  }
  return null;
}

async function patchTask(id: string, patch: Partial<Task>): Promise<void> {
  await db.update(tasks).set(patch).where(eq(tasks.id, id));
}

export function branchFor(task: Pick<Task, 'id' | 'title'>): string {
  return `genie/${task.id.slice(0, 8)}-${slugify(task.title)}`;
}

// A machine that holds the clone. A machine that stopped answering (destroyed
// from outside, say) is replaced, and the work already pushed is fetched back.
async function prepare(task: Task, project: Project): Promise<string> {
  let machineId = task.machineId;
  let cloned = false;
  if (machineId) {
    const probe = await deps.execLong(machineId, `test -d ${APP_DIR}/.git && echo ok`, { timeoutMs: 30_000 }).catch(() => null);
    cloned = probe?.stdout.trim() === 'ok';
    if (!probe) machineId = null;
  }
  if (!machineId) {
    await recordEvent(task.id, 'log', 'Starting a machine');
    notifyBoard(task);
    const m = await deps.createTaskMachine(task, project);
    machineId = m.id;
    await patchTask(task.id, { machineId: m.id, machineName: m.name });
    await recordEvent(task.id, 'log', `Machine ${m.name} is ready`);
  }
  if (!cloned) {
    await deps.cloneRepo(machineId, project.githubRepo, project.defaultBranch);
    await recordEvent(task.id, 'log', `Cloned ${project.githubRepo}`);
    notifyBoard(task);
  }
  return machineId;
}

// A person pressed Stop, or deleted the card: nothing further may happen for it.
async function assertStillWanted(taskId: string): Promise<void> {
  const row = await db.query.tasks.findFirst({ where: { id: taskId } });
  if (!row || row.error) throw new Error(row?.error ?? 'This task was deleted.');
}

async function claude(task: Task, machineId: string, opts: Omit<RunClaudeOptions, 'cwd' | 'logPath'>): Promise<ClaudeRun> {
  await assertStillWanted(task.id);
  const run = await withLogFeed(task, machineId, () => deps.runClaude(machineId, { ...opts, cwd: APP_DIR, logPath: AGENT_LOG }));
  if (run.isRateLimited) {
    const when = run.resetsAt ? `, it resets at ${run.resetsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    throw new Error(`Claude usage limit reached${when}. Retry after that.`);
  }
  await assertStillWanted(task.id);
  return run;
}

// What a run left uncommitted on the task branch still counts as its work.
async function commitLeftovers(task: Task, machineId: string, branch: string): Promise<void> {
  const cmd = `[ "$(git branch --show-current)" = ${shellQuote(branch)} ] && [ -n "$(git status --porcelain)" ] && git add -A && git commit -q -m ${shellQuote(`Finish: ${task.title.slice(0, 60)}`)} && echo committed`;
  const r = await deps.execLong(machineId, cmd, { cwd: APP_DIR, timeoutMs: 60_000 });
  if (r.stdout.includes('committed')) await recordEvent(task.id, 'log', 'Committed what the run left in the working tree');
}

function endedEarly(run: ClaudeRun): string {
  if (run.timedOut) return 'the run hit its time limit';
  if (run.subtype === 'error_max_turns') return 'the run hit its turn limit';
  return run.exitCode !== 0 ? `the run exited with code ${run.exitCode}` : '';
}

async function build(task: Task, project: Project, machineId: string): Promise<PrRef> {
  const branch = task.branch ?? branchFor(task);
  if (!task.branch) await patchTask(task.id, { branch });
  let pr = await deps.findOpenPr(project.githubRepo, branch);
  if (!pr) {
    const prompt = renderPrompt('build', {
      repo: project.githubRepo, appDir: APP_DIR, title: task.title, description: task.description || '(no description)', branch, defaultBranch: project.defaultBranch,
    });
    await recordEvent(task.id, 'log', `Building on ${branch}`);
    notifyBoard(task);
    const run = await claude(task, machineId, { prompt, timeoutMs: BUILD_TIMEOUT_MS, maxTurns: BUILD_MAX_TURNS });
    await commitLeftovers(task, machineId, branch);
    pr = (await deps.findOpenPr(project.githubRepo, branch)) ?? (await openPrBackstop(task, project, machineId, branch, run));
  }
  await patchTask(task.id, { prNumber: pr.number, prUrl: pr.url });
  await recordEvent(task.id, 'github', `Pull request #${pr.number} is open`);
  notifyBoard(task);
  return pr;
}

// The run ended before its own PR step. Push what it committed and open the PR
// here. No commits at all is a failure the card has to explain.
async function openPrBackstop(task: Task, project: Project, machineId: string, branch: string, run: ClaudeRun): Promise<PrRef> {
  const base = `origin/${project.defaultBranch}`;
  const ahead = await deps.execLong(machineId, `git rev-list --count ${shellQuote(`${base}..${branch}`)}`, { cwd: APP_DIR, timeoutMs: 30_000 });
  if (ahead.exitCode !== 0 || Number(ahead.stdout.trim()) === 0) {
    const why = endedEarly(run);
    const said = run.result.trim().slice(-500);
    throw new Error(`Claude finished without committing any change${why ? ` (${why})` : ''}.${said ? ` It said: ${said}` : ''}`);
  }
  await deps.pushBranch(machineId, branch);
  const why = endedEarly(run);
  const body = `Opened by Genie after ${why || 'the run ended before its own pull request step'}. Review the commits on \`${branch}\`.`;
  const pr = await deps.openPr(project.githubRepo, { title: task.title.slice(0, 70), head: branch, base: project.defaultBranch, body });
  await recordEvent(task.id, 'log', `Opened the pull request for the run, since ${why || 'it stopped short'}`);
  return pr;
}

async function remoteHead(machineId: string, branch: string): Promise<string> {
  const r = await deps.execLong(machineId, `git rev-parse ${shellQuote(`origin/${branch}`)}`, { cwd: APP_DIR, timeoutMs: 30_000 });
  return r.exitCode === 0 ? r.stdout.trim() : '';
}

// The feedback leaves the row only once the push is done, so a failed revise
// keeps its instruction and Retry runs it again.
async function revise(task: Task, project: Project, machineId: string): Promise<PrRef> {
  if (!task.branch || task.prNumber == null) throw new Error('This task has no pull request to revise.');
  const { branch, prNumber, feedback } = task;
  const before = await remoteHead(machineId, branch);
  const prompt = renderPrompt('revise', {
    repo: project.githubRepo, appDir: APP_DIR, prNumber: String(prNumber), branch, defaultBranch: project.defaultBranch,
    title: task.title, description: task.description || '(no description)', feedback: feedback!,
  });
  await recordEvent(task.id, 'log', 'Applying your feedback');
  notifyBoard(task);
  const run = await claude(task, machineId, { prompt, timeoutMs: REVISE_TIMEOUT_MS, maxTurns: REVISE_MAX_TURNS });
  await commitLeftovers(task, machineId, branch);
  await deps.pushBranch(machineId, branch);
  const after = await remoteHead(machineId, branch);
  await patchTask(task.id, { feedback: null });
  // Unchanged is the reviewer's call, not a failure: a Retry would only repeat it.
  if (after && after === before) await recordEvent(task.id, 'log', `The run pushed nothing new. It said: ${run.result.trim().slice(-300) || '(nothing)'}`);
  else await recordEvent(task.id, 'github', `Pushed ${after.slice(0, 7)} to the pull request`);
  return { number: prNumber, url: task.prUrl ?? '' };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// What the checks of one commit settled on. Stop is honored between polls.
async function waitForChecks(task: Task, repo: string, sha: string): Promise<CheckSummary> {
  const started = Date.now();
  for (;;) {
    await assertStillWanted(task.id);
    const checks = await deps.readChecks(repo, sha);
    if (checks.state === 'passing' || checks.state === 'failing') return checks;
    const waited = Date.now() - started;
    if (checks.state === 'none' && waited >= deps.timing.checksAppearMs) return checks;
    if (checks.state === 'pending' && waited >= deps.timing.checksFinishMs) return checks;
    await sleep(deps.timing.pollMs);
  }
}

// CI is part of done. A red check gets a run to fix it, whoever broke it, and only
// what is still red after that reaches a person, marked as such on the card.
async function settle(task: Task, project: Project, machineId: string, pr: PrRef): Promise<void> {
  const repo = project.githubRepo;
  const branch = task.branch ?? branchFor(task);
  let sha = await deps.readHeadSha(repo, pr.number);
  await recordEvent(task.id, 'log', 'Waiting for CI');
  notifyBoard(task);
  let checks = await waitForChecks(task, repo, sha);
  for (let round = 1; checks.state === 'failing' && round <= MAX_CI_FIXES; round++) {
    const names = checks.failed.map((c) => c.name).join(', ');
    await recordEvent(task.id, 'error', `CI failed: ${names}. Fixing it (try ${round} of ${MAX_CI_FIXES})`);
    notifyBoard(task);
    const prompt = renderPrompt('fix-ci', {
      repo, appDir: APP_DIR, prNumber: String(pr.number), branch, defaultBranch: project.defaultBranch, title: task.title,
      failed: checks.failed.map((c) => `- ${c.name}${c.url ? `: ${c.url}` : ''}`).join('\n'),
    });
    const run = await claude(task, machineId, { prompt, timeoutMs: FIX_CI_TIMEOUT_MS, maxTurns: FIX_CI_MAX_TURNS });
    await commitLeftovers(task, machineId, branch);
    await deps.pushBranch(machineId, branch);
    const next = await deps.readHeadSha(repo, pr.number);
    if (next === sha) {
      await recordEvent(task.id, 'error', `The fix pushed nothing new. It said: ${run.result.trim().slice(-300) || '(nothing)'}`);
      break;
    }
    sha = next;
    await recordEvent(task.id, 'log', `Pushed ${sha.slice(0, 7)}, waiting for CI again`);
    notifyBoard(task);
    checks = await waitForChecks(task, repo, sha);
  }
  await patchTask(task.id, { ciStatus: checks.state });
  await recordEvent(task.id, checks.state === 'failing' ? 'error' : 'github', CI_LINE[checks.state]);
  notifyBoard(task);
  await patchTask(task.id, { previewUrl: await preview(task, repo, machineId, pr.number, sha) });
}

const CI_LINE: Record<CheckSummary['state'], string> = {
  none: 'This repository ran no CI checks',
  pending: 'CI was still running when the wait ended',
  passing: 'CI is green',
  failing: 'CI is still failing, so this needs your call',
};

// Never fails the stage: a pull request with no preview is still a pull request.
async function preview(task: Task, repo: string, machineId: string, prNumber: number, sha: string): Promise<string | null> {
  try {
    if (await deps.repoHasService(repo)) {
      await recordEvent(task.id, 'log', 'Waiting for the Pilots preview');
      notifyBoard(task);
      const deadline = Date.now() + deps.timing.pilotsPreviewMs;
      do {
        await assertStillWanted(task.id);
        const url = await deps.findPilotsPreview(repo, prNumber, sha);
        if (url) {
          await recordEvent(task.id, 'github', 'The Pilots preview is ready');
          return url;
        }
        await sleep(deps.timing.pollMs);
      } while (Date.now() < deadline);
      await recordEvent(task.id, 'log', 'No Pilots preview in time, serving from this machine instead');
    }
    return await servePreview(task, machineId);
  } catch (err) {
    // Stop has to keep winning. Anything else only costs the preview.
    await assertStillWanted(task.id);
    await recordEvent(task.id, 'log', `No preview: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// Serves the branch from the task's machine, which sleeps when idle and wakes on the
// next request. Whatever held the port goes first: after a revise, a readiness check
// answered by the old process would present code the reviewer just rejected.
async function servePreview(task: Task, machineId: string): Promise<string | null> {
  const has = await deps.execLong(machineId, 'test -f package.json && echo yes', { cwd: APP_DIR, timeoutMs: 15_000 });
  if (!has.stdout.includes('yes')) {
    await recordEvent(task.id, 'log', 'No preview: only a Node app can be served from the machine');
    return null;
  }
  await recordEvent(task.id, 'log', 'Starting a preview on this machine');
  notifyBoard(task);
  await deps.execLong(machineId, `(fuser -k -TERM ${PREVIEW_PORT}/tcp >/dev/null 2>&1 || true); sleep 1`, { timeoutMs: 30_000 });
  const log = '/home/pilot/preview.log';
  await deps.execLong(machineId,
    `(npm install --no-audit --no-fund > ${log} 2>&1 || true); PORT=${PREVIEW_PORT} setsid nohup sh -c 'npm run start 2>&1 || npm run dev 2>&1' >> ${log} 2>&1 < /dev/null &`,
    { cwd: APP_DIR, timeoutMs: 600_000 });
  const deadline = Date.now() + deps.timing.appStartMs;
  do {
    const probe = `node -e "fetch('http://127.0.0.1:${PREVIEW_PORT}/').then((r)=>process.exit(r.status<500?0:1),()=>process.exit(1))"`;
    const r = await deps.execLong(machineId, probe, { timeoutMs: 15_000 });
    if (r.exitCode === 0) {
      await recordEvent(task.id, 'github', 'The preview is ready');
      return deps.machineUrl(machineId);
    }
    await sleep(deps.timing.pollMs);
  } while (Date.now() < deadline);
  await recordEvent(task.id, 'log', 'No preview: the app did not start on the machine');
  return null;
}

// Runs `job` while tailing the agent's stream-json log into the feed. It reads
// whole lines by number, so a poll can never split a character or drift when a
// line is redacted, and only ever one poll runs at a time.
async function withLogFeed<T>(task: Task, machineId: string, job: () => Promise<T>): Promise<T> {
  let nextLine = 1;
  let inFlight: Promise<void> | null = null;
  const read = async () => {
    try {
      for (;;) {
        const r = await deps.execLong(machineId, `tail -n +${nextLine} ${AGENT_LOG} 2>/dev/null | head -n ${LOG_BATCH_LINES} | cut -b 1-${LOG_LINE_BYTES}`, { timeoutMs: 15_000 });
        if (!r.stdout) return;
        const lines = r.stdout.split('\n');
        // Text after the last newline is a line still being written.
        lines.pop();
        if (lines.length === 0) return;
        nextLine += lines.length;
        const messages = lines.flatMap(feedLines);
        for (const message of messages) await recordEvent(task.id, 'log', message);
        if (messages.length) notifyBoard(task);
        if (lines.length < LOG_BATCH_LINES) return;
      }
    } catch {
      // A missed poll is not a failed stage. The next one reads from the same line.
    }
  };
  const poll = () => (inFlight ??= read().finally(() => { inFlight = null; }));
  await deps.execLong(machineId, `: > ${AGENT_LOG}`, { timeoutMs: 15_000 }).catch(() => null);
  const timer = setInterval(() => { void poll(); }, deps.logPollMs);
  try {
    return await job();
  } finally {
    clearInterval(timer);
    if (inFlight) await inFlight;
    await poll();
  }
}

interface StreamLine {
  type?: string;
  message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, string> }[] };
}

// One stream-json line to the feed lines a person wants to read: the agent's
// prose and the tool it reached for.
export function feedLines(line: string): string[] {
  let ev: StreamLine | null;
  try {
    ev = JSON.parse(line) as StreamLine | null;
  } catch {
    return [];
  }
  if (!ev || ev.type !== 'assistant') return [];
  const out: string[] = [];
  for (const block of ev.message?.content ?? []) {
    if (block.type === 'text' && block.text?.trim()) out.push(cap(block.text.trim().split('\n')[0]));
    if (block.type === 'tool_use') {
      const hint = String(block.input?.description ?? block.input?.command ?? block.input?.file_path ?? block.input?.pattern ?? '');
      out.push(cap(`${block.name}${hint ? `: ${hint.split('\n')[0]}` : ''}`));
    }
    if (block.type === 'server_tool_use' && block.name === 'advisor') out.push('Asked the advisor');
  }
  return out;
}

const cap = (s: string) => (s.length > LOG_LINE_MAX ? `${s.slice(0, LOG_LINE_MAX - 1)}…` : s);
