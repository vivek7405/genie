'use server';
import type { ActionResult } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { requireUser, signedOut } from '#modules/auth/session.server.ts';
import { removeTask } from '#modules/pipeline/verdicts.server.ts';

export async function deleteTask(formData: FormData): Promise<ActionResult<{ id: string }>> {
  if (!(await requireUser())) return signedOut();
  const task = await db.query.tasks.findFirst({ where: { id: String(formData.get('taskId') ?? '') } });
  if (!task) return { success: false, error: 'Unknown task.', status: 404 };
  const result = await removeTask(task);
  return result.success ? { ...result, redirect: `/projects/${task.projectId}` } : result;
}
