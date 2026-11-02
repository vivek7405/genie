'use server';
import { db } from '#db/connection.server.ts';
import type { Project } from '#db/schema.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';

export const method = 'GET';

export async function getProject(id: string): Promise<Project | null> {
  if (!(await requireUser())) return null;
  return (await db.query.projects.findFirst({ where: { id } })) ?? null;
}
