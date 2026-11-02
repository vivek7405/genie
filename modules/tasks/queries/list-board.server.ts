'use server';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';
import type { Task } from '../types.ts';

export const method = 'GET';

export async function listBoard(projectId: string): Promise<Task[]> {
  if (!(await requireUser())) return [];
  return db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.createdAt), desc(tasks.id));
}
