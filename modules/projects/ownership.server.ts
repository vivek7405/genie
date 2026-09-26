// Server-only: the one place a project is looked up as SOMEONE'S. Every
// query and action under modules/projects and modules/tasks resolves rows
// through here, so a row that belongs to another user is indistinguishable
// from one that does not exist.
import { db } from '#db/connection.server.ts';
import type { User } from '#db/schema.server.ts';
import type { Project } from './types.ts';

export async function ownedProject(id: string, user: User): Promise<Project | null> {
  return (await db.query.projects.findFirst({ where: { id, userId: user.id } })) ?? null;
}
