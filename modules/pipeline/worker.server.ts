// The in-process job runner: the tasks table is the queue. A task in a
// worker-owned column with no error is work to do.
//
// - One process, so the in-memory `running` map is the whole lock. At most one
//   task per repository runs at once, so tasks build on each other's merges.
// - At boot every claim left in the table belongs to a process that no longer
//   exists, so it is released and the first tick resumes that task.
// - Every stage has a deadline, so a hung call ends in a red card a person can
//   retry instead of a slot held forever.
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Task, TaskStatus } from '#modules/tasks/types.ts';
import { labelOf, SYSTEM_TRANSITIONS } from '#modules/tasks/utils/state-machine.ts';
import { notifyBoard, recordEvent } from './events.server.ts';
import { runStage } from './stages.server.ts';
import { failStage, transition } from './transitions.server.ts';

const STAGES = Object.keys(SYSTEM_TRANSITIONS) as TaskStatus[];
const TICK_MS = 2_000;
// A build, then up to three rounds of waiting on CI and fixing it, then a preview.
export const STAGE_DEADLINE_MS = 4 * 60 * 60_000;

interface WorkerState {
  running: Map<string, string>;
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  boot: Promise<void> | null;
  lastError: string | null;
}

// Dev re-imports modules on reload, so one loop survives instead of one per import.
const g = globalThis as unknown as { __genie_worker?: WorkerState };
const state: WorkerState = (g.__genie_worker ??= { running: new Map(), timer: null, ticking: false, boot: null, lastError: null });

let stageRunner: typeof runStage = runStage;
let deadlineMs = STAGE_DEADLINE_MS;

// Test seam.
export function setStageRunner(fn: typeof runStage | null, deadline = STAGE_DEADLINE_MS): void {
  stageRunner = fn ?? runStage;
  deadlineMs = deadline;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function concurrency(): number {
  const n = Number(process.env.GENIE_CONCURRENCY ?? 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// One pass: claims free slots and starts their stages. Never throws, and never
// overlaps itself, so a slow query cannot claim past the limit.
export async function tick(): Promise<string[]> {
  if (state.ticking) return [];
  state.ticking = true;
  try {
    if (state.boot) await state.boot;
    const candidates = await db.select().from(tasks)
      .where(and(inArray(tasks.status, STAGES), isNull(tasks.error)))
      .orderBy(asc(tasks.createdAt));
    const started: string[] = [];
    for (const task of candidates) {
      if (state.running.size >= concurrency()) break;
      if (state.running.has(task.id) || [...state.running.values()].includes(task.projectId)) continue;
      state.running.set(task.id, task.projectId);
      started.push(task.id);
      void run(task).finally(() => state.running.delete(task.id));
    }
    state.lastError = null;
    return started;
  } catch (err) {
    state.lastError = message(err);
    console.error(`[genie] worker tick failed: ${state.lastError}`);
    return [];
  } finally {
    state.ticking = false;
  }
}

function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gave up after ${Math.round(deadlineMs / 60_000)} minutes without finishing.`)), deadlineMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function run(task: Task): Promise<void> {
  try {
    // The conditions keep a card deleted, moved, or claimed by another process since
    // the query from running. A claim that outlives its process is released at the
    // next boot, or by Stop.
    const [claimed] = await db.update(tasks).set({ claimedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status), isNull(tasks.error), isNull(tasks.claimedAt)))
      .returning();
    if (!claimed) return;
    notifyBoard(claimed);
    const next = await withDeadline(stageRunner(claimed));
    if (next) await transition(claimed, next, 'system');
  } catch (err) {
    // A failure to record the failure must not reject into the void.
    await failStage(task.id, message(err)).catch((again: unknown) => console.error(`[genie] could not record a failure on ${task.id}: ${message(again)}`));
  }
}

// Clears the claims a dead process left behind; the next tick resumes them.
export async function releaseClaims(): Promise<Task[]> {
  const rows = await db.update(tasks).set({ claimedAt: null })
    .where(and(inArray(tasks.status, STAGES), isNotNull(tasks.claimedAt)))
    .returning();
  for (const row of rows) await recordEvent(row.id, 'log', `Interrupted by a restart during ${labelOf(row.status)}, resuming`);
  return rows;
}

export function isRunning(taskId: string): boolean {
  return state.running.has(taskId);
}

// Waits for in-flight runs to settle (tests).
export async function drain(): Promise<void> {
  while (state.running.size > 0) await new Promise((resolve) => setTimeout(resolve, 10));
}

export function startWorker(): void {
  if (state.timer) return;
  state.boot = releaseClaims()
    .then(() => undefined, (err: unknown) => { console.error(`[genie] releasing claims failed: ${message(err)}`); })
    .finally(() => { state.boot = null; });
  state.timer = setInterval(() => { void tick(); }, TICK_MS);
  state.timer.unref?.();
  void tick();
}

export function stopWorker(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export function workerStatus() {
  return { enabled: state.timer != null, running: [...state.running.keys()], lastError: state.lastError };
}
