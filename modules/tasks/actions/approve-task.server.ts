'use server';
// Form-bound "Approve and merge". The merge and the state change live in
// verdicts.server.ts so the GitHub sync runs the same logic.
import type { ActionResult } from '@webjsdev/server';
import { approve } from '#modules/pipeline/verdicts.server.ts';
import type { Task } from '../types.ts';

export async function approveTask(formData: FormData): Promise<ActionResult<Task>> {
  const taskId = String(formData.get('taskId') ?? '');
  const result = await approve(taskId);
  if (!result.success) return result;
  return { ...result, redirect: `/dashboard/projects/${result.data.projectId}/tasks/${result.data.id}` };
}
