// Server-only: a task is someone's through its project. The task and the
// project come back together because every caller needs both (the redirect
// after a verdict, the issue to comment on, the board to notify).
import { db } from '#db/connection.server.ts';
import type { User } from '#db/schema.server.ts';
import type { Project } from '#modules/projects/types.ts';
import type { Task } from './types.ts';

export async function ownedTask(id: string, user: User): Promise<{ task: Task; project: Project } | null> {
  const row = await db.query.tasks.findFirst({ where: { id }, with: { project: true } });
  if (!row?.project || row.project.userId !== user.id) return null;
  const { project, ...task } = row;
  return { task, project };
}
