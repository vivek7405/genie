'use server';
// The reviewer's "Request changes" verdict: the task returns to In progress
// carrying the feedback, and the worker revises on the same branch (M5).
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { transition } from '#modules/pipeline/transitions.server.ts';
import type { Task } from '../types.ts';

export async function requestChanges(formData: FormData): Promise<ActionResult<Task>> {
  const taskId = String(formData.get('taskId') ?? '');
  const feedback = String(formData.get('feedback') ?? '').trim();
  if (!feedback) return { success: false, fieldErrors: { feedback: 'Say what should change.' } };
  await db.update(tasks).set({ feedback }).where(eq(tasks.id, taskId));
  const result = await transition(taskId, 'in_progress', 'human', `Changes requested: ${feedback}`);
  if (!result.success) return result;
  return { ...result, redirect: `/projects/${result.data.projectId}/tasks/${result.data.id}` };
}
