'use server';
import { db } from '#db/connection.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';
import type { Task } from '../types.ts';

export const method = 'GET';

export async function getTask(id: string): Promise<Task | null> {
  if (!(await requireUser())) return null;
  return (await db.query.tasks.findFirst({ where: { id } })) ?? null;
}
