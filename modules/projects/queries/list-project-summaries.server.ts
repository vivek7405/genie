'use server';
// The projects ledger: every project with how many of its tasks sit in each
// column, so the list says what is happening without opening a board.
import { db } from '#db/connection.server.ts';
import type { Project } from '../types.ts';
import type { TaskStatus } from '#modules/tasks/types.ts';

export const method = 'GET';

export interface ProjectSummary {
  project: Project;
  counts: Record<TaskStatus, number>;
  total: number;
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const [projects, tasks] = await Promise.all([
    db.query.projects.findMany({ orderBy: { createdAt: 'desc' } }),
    db.query.tasks.findMany({ columns: { projectId: true, status: true } }),
  ]);
  return projects.map((project) => {
    const counts: Record<TaskStatus, number> = { todo: 0, planning: 0, in_progress: 0, ready_for_review: 0, done: 0 };
    let total = 0;
    for (const t of tasks) {
      if (t.projectId !== project.id) continue;
      counts[t.status] += 1;
      total += 1;
    }
    return { project, counts, total };
  });
}
