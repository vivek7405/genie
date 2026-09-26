'use server';
import { db } from '#db/connection.server.ts';
import type { Project } from '../types.ts';

export const method = 'GET';

export async function getProject(id: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({ where: { id } });
}
