'use server';
// The signed-in user's project, or nothing. The user comes from the session,
// never from an argument: this is an RPC endpoint, and a tenant id in the
// call would be the caller's to choose.
import { requireUser } from '#modules/auth/session.server.ts';
import { ownedProject } from '../ownership.server.ts';
import type { Project } from '../types.ts';

export const method = 'GET';

export async function getProject(id: string): Promise<Project | undefined> {
  const user = await requireUser();
  if (!user) return undefined;
  return (await ownedProject(id, user)) ?? undefined;
}
