'use server';
import type { ActionResult } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { requireUser, signedOut } from '#modules/auth/session.server.ts';
import { approve } from '#modules/pipeline/verdicts.server.ts';
import type { Task } from '../types.ts';

export async function approveTask(formData: FormData): Promise<ActionResult<Task>> {
  if (!(await requireUser())) return signedOut();
  const task = await db.query.tasks.findFirst({ where: { id: String(formData.get('taskId') ?? '') }, with: { project: true } });
  if (!task?.project) return { success: false, error: 'Unknown task.', status: 404 };
  const result = await approve(task, task.project);
  return result.success ? { ...result, redirect: `/projects/${task.projectId}/tasks/${task.id}` } : result;
}
