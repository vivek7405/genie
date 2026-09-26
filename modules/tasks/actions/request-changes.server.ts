'use server';
// Form-bound "Request changes": the task returns to In progress carrying the
// feedback, and the worker revises on the same branch. The verdict itself
// (validation included) lives in verdicts.server.ts, shared with the sync.
import type { ActionResult } from '@webjsdev/server';
import { requestChanges as requestChangesVerdict } from '#modules/pipeline/verdicts.server.ts';
import type { Task } from '../types.ts';

export async function requestChanges(formData: FormData): Promise<ActionResult<Task>> {
  const taskId = String(formData.get('taskId') ?? '');
  const feedback = String(formData.get('feedback') ?? '');
  const result = await requestChangesVerdict(taskId, feedback, 'genie');
  if (!result.success) return result;
  return { ...result, redirect: `/dashboard/projects/${result.data.projectId}/tasks/${result.data.id}` };
}
