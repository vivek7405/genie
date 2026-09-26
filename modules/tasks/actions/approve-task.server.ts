'use server';
// Form-bound "Approve and merge". The merge and the state change live in
// verdicts.server.ts so the GitHub sync runs the same logic; the ownership
// check is here, since the sync acts for the project itself.
import type { ActionResult } from '@webjsdev/server';
import { notYours, requireUser, signedOut } from '#modules/auth/session.server.ts';
import { approve } from '#modules/pipeline/verdicts.server.ts';
import { ownedTask } from '../ownership.server.ts';
import type { Task } from '../types.ts';

export async function approveTask(formData: FormData): Promise<ActionResult<Task>> {
  const user = await requireUser();
  if (!user) return signedOut();
  const taskId = String(formData.get('taskId') ?? '');
  if (!(await ownedTask(taskId, user))) return notYours('task');
  const result = await approve(taskId);
  if (!result.success) return result;
  return { ...result, redirect: `/dashboard/projects/${result.data.projectId}/tasks/${result.data.id}` };
}
