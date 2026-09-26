'use server';
import { db } from '#db/connection.server.ts';
import type { Task } from '../types.ts';

export const method = 'GET';

export async function listBoard(projectId: string): Promise<Task[]> {
  return db.query.tasks.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
}
