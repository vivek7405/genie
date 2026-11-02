'use server';
// Removes a repository from Genie, and nothing on GitHub. Refused while a task is
// being worked on, so a machine and a run are never orphaned.
import { eq, inArray } from 'drizzle-orm';
import type { ActionResult } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { projects, taskEvents, tasks } from '#db/schema.server.ts';
import { requireUser, signedOut } from '#modules/auth/session.server.ts';
import { destroyMachine } from '#modules/pipeline/pilots.server.ts';

export async function disconnectProject(formData: FormData): Promise<ActionResult<{ id: string }>> {
  if (!(await requireUser())) return signedOut();
  const id = String(formData.get('projectId') ?? '');
  const rows = await db.select().from(tasks).where(eq(tasks.projectId, id));
  if (rows.some((t) => t.claimedAt)) return { success: false, error: 'Genie is working in this repository. Try again when it finishes.', status: 409 };
  if (rows.some((t) => t.error == null && (t.status === 'backlog' || t.status === 'in_progress'))) {
    return { success: false, error: 'This repository still has queued tasks.', status: 409 };
  }
  const ids = rows.map((t) => t.id);
  if (ids.length) {
    await db.delete(taskEvents).where(inArray(taskEvents.taskId, ids));
    await db.delete(tasks).where(eq(tasks.projectId, id));
  }
  await db.delete(projects).where(eq(projects.id, id));
  await Promise.all(rows.map((t) => (t.machineId ? destroyMachine(t.machineId).catch(() => undefined) : undefined)));
  return { success: true, data: { id }, redirect: '/projects' };
}
