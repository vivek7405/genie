'use server';
import type { ActionResult } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { requireUser, signedOut } from '#modules/auth/session.server.ts';
import { requestChanges as request } from '#modules/pipeline/verdicts.server.ts';
import type { Task } from '../types.ts';

export async function requestChanges(formData: FormData): Promise<ActionResult<Task>> {
  if (!(await requireUser())) return signedOut();
  const feedback = String(formData.get('feedback') ?? '').trim();
  if (!feedback) return { success: false, fieldErrors: { feedback: 'Say what should change.' } };
  const task = await db.query.tasks.findFirst({ where: { id: String(formData.get('taskId') ?? '') } });
  if (!task) return { success: false, error: 'Unknown task.', status: 404 };
  const result = await request(task, feedback);
  return result.success ? { ...result, redirect: `/projects/${task.projectId}/tasks/${task.id}` } : result;
}
