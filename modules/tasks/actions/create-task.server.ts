'use server';
// Form-bound from the board page. A new task lands in Todo and the worker
// claims it on its next tick.
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { recordEvent, notifyBoard } from '#modules/pipeline/events.server.ts';
import type { Task } from '../types.ts';

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
}

export const validate = (input: unknown) => {
  const fd = input instanceof FormData ? input : new FormData();
  const projectId = String(fd.get('projectId') ?? '').trim();
  const title = String(fd.get('title') ?? '').trim();
  const description = String(fd.get('description') ?? '').trim();
  const fieldErrors: Record<string, string> = {};
  if (!projectId) fieldErrors.projectId = 'Missing project.';
  if (!title) fieldErrors.title = 'Give the task a title.';
  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors, values: { title, description } };
  return { success: true, data: { projectId, title, description } satisfies CreateTaskInput };
};

export async function createTask(input: CreateTaskInput): Promise<ActionResult<Task>> {
  const project = await db.query.projects.findFirst({ where: { id: input.projectId } });
  if (!project) return { success: false, error: 'Unknown project.', status: 404 };
  const [row] = await db.insert(tasks).values(input).returning();
  await recordEvent(row.id, 'status', 'Created in Todo');
  notifyBoard(row);
  return { success: true, data: row, redirect: `/dashboard/projects/${project.id}` };
}
