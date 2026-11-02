// Server-only: what a person decides about a card, shared by the actions.
import { and, eq, isNull } from 'drizzle-orm';
import type { ActionResult } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { taskEvents, tasks } from '#db/schema.server.ts';
import type { Project, Task } from '#db/schema.server.ts';
import { describeError } from '#modules/github/client.server.ts';
import { mergePr } from '#modules/github/pr.server.ts';
import { recordEvent, notifyBoard } from './events.server.ts';
import { canDelete, canStop } from '#modules/tasks/utils/state-machine.ts';
import { destroyMachine, execLong } from './pilots.server.ts';
import { transition } from './transitions.server.ts';

const conflict = (error: string): ActionResult<Task> => ({ success: false, error, status: 409 });

// Merge first: a refused merge leaves the card in Review with the reason, and
// the machine alive for a revise. A second click finds the PR merged and is a no-op.
export async function approve(task: Task, project: Project): Promise<ActionResult<Task>> {
  if (task.status === 'done') return { success: true, data: task };
  if (task.status !== 'review' || task.prNumber == null) return conflict('This task is not waiting for review.');
  try {
    await mergePr(project.githubRepo, task.prNumber);
  } catch (err) {
    return conflict(`GitHub refused the merge: ${describeError(err)}`);
  }
  const moved = await transition(task, 'done', 'human', { machineId: null, machineName: null, feedback: null });
  if (!moved) return { success: true, data: task };
  await recordEvent(task.id, 'github', `Merged pull request #${task.prNumber}`);
  if (task.machineId) {
    await destroyMachine(task.machineId).catch((err: unknown) => recordEvent(task.id, 'log', `Could not destroy the machine: ${describeError(err)}`));
  }
  notifyBoard(moved);
  return { success: true, data: moved };
}

export async function requestChanges(task: Task, feedback: string): Promise<ActionResult<Task>> {
  if (task.status !== 'review') return conflict('This task is not waiting for review.');
  const moved = await transition(task, 'in_progress', 'human', { feedback });
  if (!moved) return conflict('This task is not waiting for review.');
  await recordEvent(task.id, 'status', `Changes requested: ${feedback}`);
  notifyBoard(moved);
  return { success: true, data: moved };
}

export async function retry(task: Task): Promise<ActionResult<Task>> {
  if (!task.error) return { success: true, data: task };
  const [row] = await db.update(tasks).set({ error: null, claimedAt: null }).where(eq(tasks.id, task.id)).returning();
  if (!row) return { success: false, error: 'Unknown task.', status: 404 };
  await recordEvent(row.id, 'status', 'Retrying');
  notifyBoard(row);
  return { success: true, data: row };
}

export const STOPPED = 'Stopped. Retry to start again, or delete this task.';

// Marks the card first, so the run unwinding sees it, then ends Claude on the machine.
export async function stop(task: Task): Promise<ActionResult<Task>> {
  if (!canStop(task)) return conflict('This task is not running.');
  const [row] = await db.update(tasks).set({ error: STOPPED, claimedAt: null }).where(and(eq(tasks.id, task.id), isNull(tasks.error))).returning();
  if (!row) return { success: true, data: task };
  await recordEvent(row.id, 'status', 'Stopped');
  notifyBoard(row);
  if (row.machineId) await execLong(row.machineId, `pkill -f '[c]laude -p' || true`, { timeoutMs: 30_000 }).catch(() => undefined);
  return { success: true, data: row };
}

export async function removeTask(task: Task): Promise<ActionResult<{ id: string }>> {
  if (!canDelete(task)) return { success: false, error: 'This task cannot be deleted right now.', status: 409 };
  const [gone] = await db.delete(tasks).where(and(eq(tasks.id, task.id), isNull(tasks.claimedAt))).returning();
  if (!gone) return { success: false, error: 'Genie just picked this task up.', status: 409 };
  await db.delete(taskEvents).where(eq(taskEvents.taskId, task.id));
  if (task.machineId) await destroyMachine(task.machineId).catch(() => undefined);
  notifyBoard(gone);
  return { success: true, data: { id: task.id } };
}
