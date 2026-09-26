'use server';
import { requireUser } from '#modules/auth/session.server.ts';
import { ownedTask } from '../ownership.server.ts';
import type { Task } from '../types.ts';

export const method = 'GET';

export async function getTask(id: string): Promise<Task | undefined> {
  const user = await requireUser();
  if (!user) return undefined;
  return (await ownedTask(id, user))?.task;
}
