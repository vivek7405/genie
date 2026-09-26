'use server';
import { db } from '#db/connection.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';
import type { Project } from '../types.ts';

export const method = 'GET';

export async function listProjects(): Promise<Project[]> {
  const user = await requireUser();
  if (!user) return [];
  return db.query.projects.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
}
