'use server';
import { db } from '#db/connection.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';
import { ownedProject } from '#modules/projects/ownership.server.ts';
import type { Task } from '../types.ts';

export const method = 'GET';

export async function listBoard(projectId: string): Promise<Task[]> {
  const user = await requireUser();
  if (!user || !(await ownedProject(projectId, user))) return [];
  return db.query.tasks.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
}
