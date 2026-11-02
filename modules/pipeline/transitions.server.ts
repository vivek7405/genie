// Server-only: the one place a task's status changes. Enforces the state machine
// with a conditional update, so two racing callers cannot both move a card.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Task, TaskStatus } from '#modules/tasks/types.ts';
import { canTransition, labelOf, type Actor } from '#modules/tasks/utils/state-machine.ts';
import { recordEvent, notifyBoard } from './events.server.ts';
import { redact } from './pilots.server.ts';

export async function transition(task: Pick<Task, 'id' | 'status'>, to: TaskStatus, actor: Actor, patch: Partial<Task> = {}): Promise<Task | null> {
  if (!canTransition(task.status, to, actor)) return null;
  const [row] = await db.update(tasks)
    .set({ ...patch, status: to, claimedAt: null, error: null })
    // A worker finishing a stage must not undo a Stop that landed while it ran.
    .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status), actor === 'system' ? isNull(tasks.error) : undefined))
    .returning();
  if (!row) return null;
  await recordEvent(row.id, 'status', `Moved to ${labelOf(to)}`);
  notifyBoard(row);
  return row;
}

// A failed stage keeps its column and shows the error; Retry clears it. The first
// error wins, so a run unwinding after a Stop keeps the card saying it was stopped.
export async function failStage(taskId: string, error: string): Promise<void> {
  const [row] = await db.update(tasks).set({ error: redact(error), claimedAt: null }).where(and(eq(tasks.id, taskId), isNull(tasks.error))).returning();
  if (!row) return;
  await recordEvent(row.id, 'error', error);
  notifyBoard(row);
}
