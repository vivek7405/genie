'use server';
// The reviewer's "Approve" verdict. M5 adds the PR merge; for now it is the
// state change alone.
import type { ActionResult } from '@webjsdev/server';
import { transition } from '#modules/pipeline/transitions.server.ts';
import type { Task } from '../types.ts';

export async function approveTask(formData: FormData): Promise<ActionResult<Task>> {
  const taskId = String(formData.get('taskId') ?? '');
  const result = await transition(taskId, 'done', 'human', 'Approved by reviewer');
  if (!result.success) return result;
  return { ...result, redirect: `/dashboard/projects/${result.data.projectId}/tasks/${result.data.id}` };
}
