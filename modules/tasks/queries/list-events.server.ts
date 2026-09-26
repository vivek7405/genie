'use server';
import { db } from '#db/connection.server.ts';
import type { TaskEvent } from '../types.ts';

export const method = 'GET';

export async function listEvents(taskId: string): Promise<TaskEvent[]> {
  return db.query.taskEvents.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
}
