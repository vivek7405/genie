// Server-only: the one place a task's status changes. Enforces the state
// machine, writes the feed line, pushes the board, and mirrors the card to
// GitHub (awaited, never throwing).
import { eq, sql } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import type { Task, TaskStatus } from '#modules/tasks/types.ts';
import { canTransition, labelOf, type Actor } from '#modules/tasks/utils/state-machine.ts';
import { clock } from '#modules/tasks/utils/ui/clock.ts';
import { mirrorTask } from '#modules/github/mirror.server.ts';
import { recordEvent, notifyBoard } from './events.server.ts';
import { redact } from './pilots.server.ts';

export async function transition(
  taskId: string,
  to: TaskStatus,
  actor: Actor,
  note?: string,
): Promise<ActionResult<Task> & { success: true; data: Task } | ActionResult<Task> & { success: false }> {
  const task = await db.query.tasks.findFirst({ where: { id: taskId } });
  if (!task) return { success: false, error: 'Unknown task.', status: 404 };
  if (!canTransition(task.status, to, actor)) {
    return { success: false, error: `A task in ${labelOf(task.status)} cannot move to ${labelOf(to)}.`, status: 409 };
  }
  const patch: Partial<Task> = { status: to };
  // A stage the worker finishes releases the claim and ends its deferral
  // history; the next stage re-claims and starts its own count.
  if (actor === 'system') Object.assign(patch, { claimedAt: null, deferredUntil: null, deferReason: null, deferCount: 0 });
  const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, taskId)).returning();
  await recordEvent(row.id, 'status', note ?? `${labelOf(task.status)} to ${labelOf(to)}`);
  notifyBoard(row);
  await mirrorTask(row);
  return { success: true, data: row };
}

export async function failStage(taskId: string, error: string): Promise<void> {
  const [row] = await db.update(tasks).set({ error: redact(error), claimedAt: null }).where(eq(tasks.id, taskId)).returning();
  if (!row) return;
  await recordEvent(row.id, 'error', error);
  notifyBoard(row);
}

// The third way a stage ends: not advanced, not failed, waiting. The claim is
// released so the stale query never mistakes the wait for a crash, and the
// worker skips the task until `untilMs`. The stage keeps its attempt number.
export async function deferTask(taskId: string, untilMs: number, reason: string): Promise<void> {
  const until = new Date(untilMs);
  const [row] = await db
    .update(tasks)
    .set({ deferredUntil: until, deferReason: reason, deferCount: sql`${tasks.deferCount} + 1`, claimedAt: null })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!row) return;
  await recordEvent(row.id, 'log', `${reason}, retrying at ${clock(until)}`);
  notifyBoard(row);
}
