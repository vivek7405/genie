'use server';
import { db } from '#db/connection.server.ts';
import type { Task } from '../types.ts';

export const method = 'GET';

export async function getTask(id: string): Promise<Task | undefined> {
  return db.query.tasks.findFirst({ where: { id } });
}
