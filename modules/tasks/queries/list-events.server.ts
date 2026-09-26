'use server';
import { db } from '#db/connection.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';
import { ownedTask } from '../ownership.server.ts';
import type { TaskEvent } from '../types.ts';

export const method = 'GET';

export async function listEvents(taskId: string): Promise<TaskEvent[]> {
  const user = await requireUser();
  if (!user || !(await ownedTask(taskId, user))) return [];
  return db.query.taskEvents.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
}
