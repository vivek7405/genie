// The in-process job runner. WebJs has no queue or scheduler, so genie keeps
// one worker loop alive from instrumentation.ts and uses the tasks table as
// the queue: a task in a system-owned stage with no error is work to do.
//
// The claim rules, in the order tick() applies them:
//
// - A deferred task (deferred_until in the future) is skipped. A Claude rate
//   limit is a wait, not a failure: run() parks the task with deferTask and
//   the backoff below, and the stage keeps its attempt number when it resumes.
// - At most one task per project is in flight, in memory (state.running) and
//   in SQL (no sibling row with a fresh claim), so two tasks never clone,
//   branch and push against the same repository at once.
// - A claim is stale after a window that depends on the stage (STALE_AFTER_MS):
//   a crashed planning run is re-claimed in minutes, a 45 minute build is not
//   re-claimed by mistake. A stale re-claim writes an "expired" feed line.
// - A stale task that already ran GENIE_MAX_ATTEMPTS times is failed with a
//   "Gave up" error instead of being re-claimed, so a crash loop ends in a red
//   card. Retry resets the count.
// - At boot, releaseClaims('restart') clears every claim left by the process
//   that died (a pilots redeploy is a power cut, no signal reaches the guest),
//   and the first tick re-claims those tasks at once. On SIGTERM stopWorker()
//   drains for GENIE_DRAIN_MS, then releases what is still running.
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, not, notExists, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Task, TaskStatus } from '#modules/tasks/types.ts';
import { SYSTEM_TRANSITIONS, labelOf } from '#modules/tasks/utils/state-machine.ts';
import { stopSync } from '#modules/github/sync.server.ts';
import { recordEvent, notifyBoard } from './events.server.ts';
import { RateLimitedError, runStage } from './stages.server.ts';
import { transition, failStage, deferTask } from './transitions.server.ts';

// How long a claim may hold each stage before it counts as a crashed run.
// Constants, not env: they are the pipeline's budgets, like the prompts'
// timeouts in stages.server.ts.
export const STALE_AFTER_MS = {
  todo: 5 * 60_000, // claim to planning is instant; 5 min covers a slow machine create
  planning: 15 * 60_000, // clone, npm ci and a 2 to 3 min timeboxed plan run
  in_progress: 90 * 60_000, // 45 min build, 10 min preview poll, a revise round trip
} as const satisfies Partial<Record<TaskStatus, number>>;

type SystemStage = keyof typeof STALE_AFTER_MS;
const SYSTEM_STAGES = Object.keys(SYSTEM_TRANSITIONS) as SystemStage[];

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_DRAIN_MS = 8000;
export const RATE_LIMIT_REASON = 'Waiting for Claude quota';

// Minutes between tries when Claude does not say when its window resets:
// 5, 15, 30, then 60 forever (a subscription window is 5 hours, so the cap
// retries at most five times per window).
const BACKOFF_MIN = [5, 15, 30, 60] as const;
// A reset instant further out than this is not trusted over the schedule.
const RESET_HORIZON_MS = 6 * 60 * 60_000;

// When a rate-limited stage is tried again. Claude's own reset instant, plus
// a minute of slack, wins over the schedule when it is ahead of now and
// plausible.
export function nextDeferral(deferCount: number, resetsAt: Date | null | undefined, now = Date.now()): number {
  const scheduled = now + BACKOFF_MIN[Math.min(deferCount, BACKOFF_MIN.length - 1)] * 60_000;
  if (resetsAt && resetsAt.getTime() > now && resetsAt.getTime() - now <= RESET_HORIZON_MS) return resetsAt.getTime() + 60_000;
  return scheduled;
}

export interface RunningTask {
  projectId: string;
  status: TaskStatus;
  startedAt: Date;
}

interface WorkerState {
  running: Map<string, RunningTask>;
  timer: ReturnType<typeof setInterval> | null;
  // The boot-time claim release; every tick waits for it.
  boot: Promise<void> | null;
  stopping: boolean;
  startedAt: Date | null;
  intervalMs: number;
  concurrency: number;
  lastTickAt: Date | null;
  lastTickError: string | null;
  // Signal handlers and the boot release run once per process, not once per
  // dev reload.
  installed: boolean;
}

// Dev re-imports modules on reload; the state rides globalThis so one loop
// survives, not one per import.
const g = globalThis as unknown as { __genie_worker?: WorkerState };
const state: WorkerState = (g.__genie_worker ??= {
  running: new Map(),
  timer: null,
  boot: null,
  stopping: false,
  startedAt: null,
  intervalMs: 0,
  concurrency: 0,
  lastTickAt: null,
  lastTickError: null,
  installed: false,
});

export interface WorkerOptions {
  concurrency?: number;
  intervalMs?: number;
}

// The stage the worker runs. A test swaps it (a stage that throws a rate
// limit, a stage that hangs) without touching stages.server.ts.
type StageRunner = typeof runStage;
let stageRunner: StageRunner = runStage;
export function setStageRunner(fn: StageRunner | null): void {
  stageRunner = fn ?? runStage;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function maxAttempts(): number {
  const n = Number(process.env.GENIE_MAX_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ATTEMPTS;
}

// A claim younger than its stage's window: the run may still be executing.
function freshClaim(t: typeof tasks, now: number): SQL {
  return or(...SYSTEM_STAGES.map((s) => and(eq(t.status, s), gte(t.claimedAt, new Date(now - STALE_AFTER_MS[s])))))!;
}

// One pass: claim up to `concurrency` free slots and run each task's stage.
// Returns the ids it started, so a test can await them via `drain()`. Never
// throws: a failing pass is recorded for /health and the next interval tries
// again.
export async function tick(opts: WorkerOptions = {}): Promise<string[]> {
  if (state.stopping) return [];
  if (state.boot) await state.boot;
  try {
    const started = await claim(opts.concurrency ?? Number(process.env.GENIE_CONCURRENCY ?? 1));
    state.lastTickError = null;
    return started;
  } catch (err) {
    state.lastTickError = message(err);
    console.error(`[genie] worker tick failed: ${state.lastTickError}`);
    return [];
  } finally {
    state.lastTickAt = new Date();
  }
}

async function claim(concurrency: number): Promise<string[]> {
  const free = concurrency - state.running.size;
  if (free <= 0) return [];
  const now = Date.now();
  const other = alias(tasks, 'other');
  const candidates = await db
    .select()
    .from(tasks)
    .where(and(
      inArray(tasks.status, SYSTEM_STAGES),
      isNull(tasks.error),
      or(isNull(tasks.deferredUntil), lte(tasks.deferredUntil, new Date(now))),
      or(isNull(tasks.claimedAt), not(freshClaim(tasks, now))),
      // The SQL half of the per-project cap: after a crash the sibling waits
      // for the stale window rather than racing a run that may still be
      // executing on a machine.
      notExists(db.select().from(other).where(and(
        eq(other.projectId, tasks.projectId),
        ne(other.id, tasks.id),
        isNotNull(other.claimedAt),
        freshClaim(other as unknown as typeof tasks, now),
      ))),
    ))
    .orderBy(tasks.createdAt);
  const started: string[] = [];
  const busyProjects = new Set([...state.running.values()].map((r) => r.projectId));
  for (const task of candidates) {
    if (started.length >= free) break;
    if (state.running.has(task.id) || busyProjects.has(task.projectId)) continue;
    // A stale re-claim past the ceiling ends in a red card a human can read.
    if (task.claimedAt && task.attempt >= maxAttempts()) {
      await failStage(task.id, `Gave up after ${task.attempt} attempts: the stage never completed`);
      continue;
    }
    state.running.set(task.id, { projectId: task.projectId, status: task.status, startedAt: new Date() });
    busyProjects.add(task.projectId);
    started.push(task.id);
    void run(task).finally(() => state.running.delete(task.id));
  }
  return started;
}

// A rate limit surfaces from the stage as a RateLimitedError carrying
// Claude's reset instant when it reported one.
function rateLimitOf(err: unknown): { resetsAt: Date | null } | null {
  if (!(err instanceof RateLimitedError)) return null;
  return { resetsAt: err.resetsAt instanceof Date ? err.resetsAt : null };
}

async function run(task: Task): Promise<void> {
  // A deferred re-claim resumes the same attempt; every other claim is a new
  // stage start, which is what the card's "attempt N" counts.
  const resuming = task.deferredUntil != null;
  let deferCount = task.deferCount;
  try {
    const [claimed] = await db
      .update(tasks)
      .set({
        claimedAt: new Date(),
        deferredUntil: null,
        deferReason: null,
        ...(resuming ? {} : { attempt: sql`${tasks.attempt} + 1` }),
      })
      .where(eq(tasks.id, task.id))
      .returning();
    deferCount = claimed.deferCount;
    if (task.claimedAt) {
      const minutes = Math.round((Date.now() - task.claimedAt.getTime()) / 60_000);
      await recordEvent(claimed.id, 'log', `Claim from attempt ${task.attempt} expired after ${minutes} min, re-claiming`);
    }
    const next = await stageRunner(claimed);
    if (next) await transition(claimed.id, next, 'system');
  } catch (err) {
    const limit = rateLimitOf(err);
    if (limit) {
      await deferTask(task.id, nextDeferral(deferCount, limit.resetsAt), RATE_LIMIT_REASON);
      return;
    }
    // Nothing here may reject into the void: a failure to record the failure
    // is logged, and the claim goes stale on its own.
    await failStage(task.id, message(err)).catch((again: unknown) => console.error(`[genie] failStage for ${task.id} failed: ${message(again)}`));
  }
}

// Clears the claims a dead process left behind. One replica means no other
// live claimant, so at boot every claim found belongs to a process that no
// longer exists; on shutdown `ids` narrows it to what this process was
// running. The next tick re-claims them at once, no stale window.
export async function releaseClaims(cause: 'restart' | 'shutdown', ids?: string[]): Promise<Task[]> {
  if (ids && ids.length === 0) return [];
  const rows = await db
    .update(tasks)
    .set({ claimedAt: null })
    .where(and(inArray(tasks.status, SYSTEM_STAGES), isNotNull(tasks.claimedAt), ids ? inArray(tasks.id, ids) : undefined))
    .returning();
  for (const row of rows) {
    await recordEvent(row.id, 'log', `Interrupted by a ${cause} during ${labelOf(row.status)}, the next worker resumes it`);
    notifyBoard(row);
  }
  return rows;
}

// Waits for every in-flight run to settle (tests, shutdown).
export async function drain(): Promise<void> {
  while (state.running.size > 0) await sleep(20);
}

export function startWorker(opts: WorkerOptions = {}): void {
  if (state.timer) return;
  const intervalMs = opts.intervalMs ?? Number(process.env.GENIE_TICK_MS ?? 2000);
  state.intervalMs = intervalMs;
  state.concurrency = opts.concurrency ?? Number(process.env.GENIE_CONCURRENCY ?? 1);
  state.startedAt = new Date();
  state.stopping = false;
  if (!state.installed) {
    state.installed = true;
    // webjs installs its own once-handlers after register(), so this drain
    // starts first and the two run side by side; the framework does the exit.
    const shutdown = () => { void Promise.all([stopWorker(), stopSync()]); };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    state.boot = releaseClaims('restart')
      .then((rows) => { if (rows.length) console.log(`[genie] released ${rows.length} claim(s) left by the previous process`); })
      .catch((err: unknown) => { console.error(`[genie] boot-time claim release failed: ${message(err)}`); })
      .finally(() => { state.boot = null; });
  }
  state.timer = setInterval(() => { void tick(opts); }, intervalMs);
  state.timer.unref?.();
  void tick(opts);
}

// Stops claiming, waits up to GENIE_DRAIN_MS for the in-flight runs, then
// releases the claims of whatever is still running so the next boot resumes
// them on its first tick. The Claude process keeps running on its machine.
export async function stopWorker(): Promise<void> {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.stopping = true;
  try {
    const drainMs = Number(process.env.GENIE_DRAIN_MS ?? DEFAULT_DRAIN_MS);
    const deadline = Date.now() + drainMs;
    while (state.running.size > 0 && Date.now() < deadline) await sleep(20);
    if (state.running.size > 0) await releaseClaims('shutdown', [...state.running.keys()]);
  } finally {
    // So a test can start the worker again in the same process.
    state.stopping = false;
  }
}

export interface WorkerStatus {
  enabled: boolean;
  stopping: boolean;
  concurrency: number;
  intervalMs: number;
  startedAt: Date | null;
  lastTickAt: Date | null;
  lastTickError: string | null;
  running: Array<{ taskId: string; projectId: string; status: TaskStatus; since: Date }>;
}

// What GET /health reports about the loop.
export function workerStatus(): WorkerStatus {
  return {
    enabled: state.timer != null || state.stopping,
    stopping: state.stopping,
    concurrency: state.concurrency,
    intervalMs: state.intervalMs,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    lastTickError: state.lastTickError,
    running: [...state.running].map(([taskId, r]) => ({ taskId, projectId: r.projectId, status: r.status, since: r.startedAt })),
  };
}
