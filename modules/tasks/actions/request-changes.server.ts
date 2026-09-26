'use server';
// Form-bound "Request changes": the task returns to In progress carrying the
// feedback, and the worker revises on the same branch. The verdict itself
// (validation included) lives in verdicts.server.ts, shared with the sync;
// the ownership check is here.
import type { ActionResult } from '@webjsdev/server';
import { notYours, requireUser, signedOut } from '#modules/auth/session.server.ts';
import { requestChanges as requestChangesVerdict } from '#modules/pipeline/verdicts.server.ts';
import { ownedTask } from '../ownership.server.ts';
import type { Task } from '../types.ts';

export async function requestChanges(formData: FormData): Promise<ActionResult<Task>> {
  const user = await requireUser();
  if (!user) return signedOut();
  const taskId = String(formData.get('taskId') ?? '');
  const feedback = String(formData.get('feedback') ?? '');
  if (!(await ownedTask(taskId, user))) return notYours('task');
  const result = await requestChangesVerdict(taskId, feedback, 'genie');
  if (!result.success) return result;
  return { ...result, redirect: `/dashboard/projects/${result.data.projectId}/tasks/${result.data.id}` };
}
