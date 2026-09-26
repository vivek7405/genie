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
import { commentOnIssue, readIssue } from '#modules/github/issues.server.ts';
import { findPreviewUrl } from '#modules/github/pr.server.ts';
import { createTaskMachine, execLong, readFile, type ExecOptions, type ExecResult } from './pilots.server.ts';
import { runClaude, type ClaudeRun, type RunClaudeOptions } from './claude.server.ts';
import { cloneRepo, pushBranch } from './git.server.ts';
import { recordEvent } from './events.server.ts';
import { slugify } from './prompts.server.ts';

export const APP_DIR = '/home/pilot/app';
export const PLAN_PATH = '/home/pilot/PLAN.md';
export const AGENT_LOG = '/home/pilot/agent.log';

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
    // planning and in_progress still advance without work; the next commits
    // replace each with its real stage.
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
