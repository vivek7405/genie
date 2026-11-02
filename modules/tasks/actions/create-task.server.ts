'use server';
import type { ActionResult } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import { requireUser, signedOut } from '#modules/auth/session.server.ts';
import { notifyBoard, recordEvent } from '#modules/pipeline/events.server.ts';
import type { Task } from '../types.ts';

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
}

const TITLE_MAX = 200;

export const validate = (input: unknown) => {
  const fd = input instanceof FormData ? input : new FormData();
  const projectId = String(fd.get('projectId') ?? '').trim();
  const title = String(fd.get('title') ?? '').trim();
  const description = String(fd.get('description') ?? '').trim();
  if (!title) return { success: false, fieldErrors: { title: 'Say what Genie should do.' } };
  if (title.length > TITLE_MAX) return { success: false, fieldErrors: { title: `Keep the title under ${TITLE_MAX} characters. Details go in the description.` } };
  return { success: true, data: { projectId, title, description } satisfies CreateTaskInput };
};

export async function createTask(input: CreateTaskInput): Promise<ActionResult<Task>> {
  if (!(await requireUser())) return signedOut();
  const project = await db.query.projects.findFirst({ where: { id: input.projectId } });
  if (!project) return { success: false, error: 'Unknown project.', status: 404 };
  const [row] = await db.insert(tasks).values(input).returning();
  await recordEvent(row.id, 'status', 'Added to the backlog');
  notifyBoard(row);
  return { success: true, data: row, redirect: `/projects/${project.id}` };
}
