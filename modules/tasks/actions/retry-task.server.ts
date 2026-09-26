'use server';
// Retry re-runs the stage the task failed in; the stage reuses the task's
// machine when it still exists. Clears the error and the claim so the worker
// picks the row up again, and resets the attempt count so the card counts
// tries since the last human Retry (and #6's attempt ceiling starts over).
// #6 adds deferredUntil, deferReason and deferCount (the rate-limit backoff);
// a retry must clear those too, or the worker keeps waiting out a backoff the
// human just overrode. Add them to this set when the columns land.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { recordEvent, notifyBoard } from '#modules/pipeline/events.server.ts';
import type { Task } from '../types.ts';

export async function retryTask(formData: FormData): Promise<ActionResult<Task>> {
  const taskId = String(formData.get('taskId') ?? '');
  const [row] = await db.update(tasks).set({ error: null, claimedAt: null, attempt: 0 }).where(eq(tasks.id, taskId)).returning();
  if (!row) return { success: false, error: 'Unknown task.', status: 404 };
  await recordEvent(row.id, 'status', 'Retrying');
  notifyBoard(row);
  return { success: true, data: row, redirect: `/dashboard/projects/${row.projectId}/tasks/${row.id}` };
}
