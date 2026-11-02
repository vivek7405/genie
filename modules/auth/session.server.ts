// Who is signed in. A server-only utility: the row never crosses the RPC boundary.
import { db } from '#db/connection.server.ts';
import type { User } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { auth } from './auth.server.ts';

// The users row for this request, or null. The row exists only for the operator
// (sign-in refuses everyone else), so a validly signed cookie for another person
// reads as signed out.
export async function requireUser(req?: Request): Promise<User | null> {
  const session = await auth(req);
  const githubId = Number(session?.user?.id);
  if (!Number.isInteger(githubId)) return null;
  return (await db.query.users.findFirst({ where: { githubId } })) ?? null;
}

// An action returns this rather than throwing: a throw is sanitized to a 500.
export function signedOut(): ActionResult<never> & { success: false } {
  return { success: false, error: 'Sign in to continue.', status: 401 };
}
