// The in-process job runner. webjs has no queue or scheduler, so genie keeps
// one worker loop alive from instrumentation.ts and uses the tasks table as
// the queue: a task in a system-owned stage with no error is work to do.
import { and, inArray, isNull, or, lt, eq, sql } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Task } from '#modules/tasks/types.ts';
import { SYSTEM_TRANSITIONS } from '#modules/tasks/utils/state-machine.ts';
import { runStage } from './stages.server.ts';
import { transition, failStage } from './transitions.server.ts';

const SYSTEM_STAGES = Object.keys(SYSTEM_TRANSITIONS) as Task['status'][];
// A claim older than this is a crashed run; the task is claimable again.
const STALE_CLAIM_MS = 2 * 60 * 60 * 1000;

interface WorkerState {
  running: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
}

// Dev re-imports modules on reload; the state rides globalThis so one loop
// survives, not one per import.
const g = globalThis as unknown as { __genie_worker?: WorkerState };
const state: WorkerState = (g.__genie_worker ??= { running: new Set(), timer: null });

export interface WorkerOptions {
  concurrency?: number;
  intervalMs?: number;
}

// One pass: claim up to `concurrency` free slots and run each task's stage.
// Returns the ids it started, so a test can await them via `drain()`.
export async function tick(opts: WorkerOptions = {}): Promise<string[]> {
  const concurrency = opts.concurrency ?? Number(process.env.GENIE_CONCURRENCY ?? 1);
  const free = concurrency - state.running.size;
  if (free <= 0) return [];
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const candidates = await db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, SYSTEM_STAGES), isNull(tasks.error), or(isNull(tasks.claimedAt), lt(tasks.claimedAt, staleBefore))))
    .orderBy(tasks.createdAt)
    .limit(free + state.running.size);
  const started: string[] = [];
  for (const task of candidates) {
    if (started.length >= free) break;
    if (state.running.has(task.id)) continue;
    state.running.add(task.id);
    started.push(task.id);
    void run(task).finally(() => state.running.delete(task.id));
  }
  return started;
}

async function run(task: Task): Promise<void> {
  const [claimed] = await db
    .update(tasks)
    .set({ claimedAt: new Date(), attempt: sql`${tasks.attempt} + 1` })
    .where(eq(tasks.id, task.id))
    .returning();
  try {
    const next = await runStage(claimed);
    if (next) await transition(claimed.id, next, 'system');
  } catch (err) {
    await failStage(claimed.id, err instanceof Error ? err.message : String(err));
  }
}

// Waits for every in-flight run to settle (tests, shutdown).
export async function drain(): Promise<void> {
  while (state.running.size > 0) await new Promise((r) => setTimeout(r, 20));
}

export function startWorker(opts: WorkerOptions = {}): void {
  if (state.timer) return;
  const intervalMs = opts.intervalMs ?? Number(process.env.GENIE_TICK_MS ?? 2000);
  state.timer = setInterval(() => { void tick(opts); }, intervalMs);
  state.timer.unref?.();
  void tick(opts);
}

export function stopWorker(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}
