'use server';
// Clears a failed stage's error so the worker picks the task up again from
// the stage it failed in.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { recordEvent, notifyBoard } from '#modules/pipeline/events.server.ts';
import type { Task } from '../types.ts';

export async function retryTask(formData: FormData): Promise<ActionResult<Task>> {
  const taskId = String(formData.get('taskId') ?? '');
  const [row] = await db.update(tasks).set({ error: null, claimedAt: null }).where(eq(tasks.id, taskId)).returning();
  if (!row) return { success: false, error: 'Unknown task.', status: 404 };
  await recordEvent(row.id, 'status', 'Retrying');
  notifyBoard(row);
  return { success: true, data: row, redirect: `/projects/${row.projectId}/tasks/${row.id}` };
}
