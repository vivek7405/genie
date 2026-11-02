'use server';
import { desc } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { projects, tasks } from '#db/schema.server.ts';
import type { Project } from '#db/schema.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';
import type { TaskStatus } from '#modules/tasks/types.ts';

export const method = 'GET';

export interface ProjectSummary {
  project: Project;
  counts: Record<TaskStatus, number>;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!(await requireUser())) return [];
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  const all = await db.select().from(tasks);
  return rows.map((project) => {
    const counts: Record<TaskStatus, number> = { backlog: 0, in_progress: 0, review: 0, done: 0 };
    for (const t of all) if (t.projectId === project.id) counts[t.status]++;
    return { project, counts };
  });
}
