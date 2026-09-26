'use server';
// Clears a failed stage's error so the worker picks the task up again from
// the stage it failed in. The attempt count and the deferral history start
// over: Retry is a human saying "try again from zero", and the worker's
// attempt ceiling counts from here.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { notYours, requireUser, signedOut } from '#modules/auth/session.server.ts';
import { recordEvent, notifyBoard } from '#modules/pipeline/events.server.ts';
import { ownedTask } from '../ownership.server.ts';
import type { Task } from '../types.ts';

export async function retryTask(formData: FormData): Promise<ActionResult<Task>> {
  const user = await requireUser();
  if (!user) return signedOut();
  const taskId = String(formData.get('taskId') ?? '');
  if (!(await ownedTask(taskId, user))) return notYours('task');
  const [row] = await db
    .update(tasks)
    .set({ error: null, claimedAt: null, deferredUntil: null, deferReason: null, deferCount: 0, attempt: 0 })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!row) return notYours('task');
  await recordEvent(row.id, 'status', 'Retrying');
  notifyBoard(row);
  return { success: true, data: row, redirect: `/dashboard/projects/${row.projectId}/tasks/${row.id}` };
}
