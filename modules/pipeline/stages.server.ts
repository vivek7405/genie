// Server-only: the work each worker-owned column does.
//
//   backlog      prepare         a Pilots machine with the repo cloned
//   in_progress  build           one Claude run plans, builds, pushes, opens the PR
//                revise          when the row carries feedback: a run on the same
//                                branch and pull request
//
// Every stage is safe to run twice on the same row (a restart, a Retry): the
// machine and branch are reused and an open PR is looked up before Claude runs.
// Every side effect goes through `deps`, the test seam.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Project, Task } from '#db/schema.server.ts';
import type { TaskStatus } from '#modules/tasks/types.ts';
import { findOpenPr, openPr, type PrRef } from '#modules/github/pr.server.ts';
import { runClaude, type ClaudeRun, type RunClaudeOptions } from './claude.server.ts';
import { recordEvent, notifyBoard } from './events.server.ts';
import { APP_DIR, cloneRepo, pushBranch } from './git.server.ts';
import { createTaskMachine, execLong, shellQuote, type ExecOptions, type ExecResult } from './pilots.server.ts';
import { renderPrompt, slugify } from './prompts.server.ts';

export const AGENT_LOG = '/home/pilot/agent.log';
const BUILD_TIMEOUT_MS = 45 * 60_000;
const BUILD_MAX_TURNS = 200;
const REVISE_TIMEOUT_MS = 30 * 60_000;
const REVISE_MAX_TURNS = 120;
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
  logPollMs: number;
}

const defaults: StageDeps = { createTaskMachine, execLong, runClaude, cloneRepo, pushBranch, findOpenPr, openPr, logPollMs: 4_000 };
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
    await (task.feedback ? revise(task, project, machineId) : build(task, project, machineId));
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

async function build(task: Task, project: Project, machineId: string): Promise<void> {
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
async function revise(task: Task, project: Project, machineId: string): Promise<void> {
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
