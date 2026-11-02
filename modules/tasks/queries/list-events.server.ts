'use server';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { taskEvents } from '#db/schema.server.ts';
import { requireUser } from '#modules/auth/session.server.ts';
import type { TaskEvent } from '../types.ts';

export const method = 'GET';

const LIMIT = 300;

// Newest first, capped: a long build logs thousands of lines. rowid is insertion
// order, which a timestamp cannot give for lines written in the same millisecond.
export async function listEvents(taskId: string): Promise<TaskEvent[]> {
  if (!(await requireUser())) return [];
  return db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId)).orderBy(desc(sql`rowid`)).limit(LIMIT);
}
