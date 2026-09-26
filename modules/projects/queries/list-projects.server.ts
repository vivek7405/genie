'use server';
import { db } from '#db/connection.server.ts';
import type { Project } from '../types.ts';

export const method = 'GET';

export async function listProjects(): Promise<Project[]> {
  return db.query.projects.findMany({ orderBy: { createdAt: 'desc' } });
}
