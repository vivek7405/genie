/**
 * Who is signed in, for a page, a layout, a route handler or an action.
 *
 * A server-only utility (no `'use server'`): everything here is called
 * server-to-server, and the `users` row it returns carries the GitHub access
 * token, which must never cross the RPC boundary.
 */
import { db } from '#db/connection.server.ts';
import type { User } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { auth } from './auth.server.ts';

/**
 * The `users` row for the session on this request, or null when signed out.
 *
 * `auth(req)` reads the signed cookie; the row is then looked up by the
 * GitHub id the cookie carries, so a deleted user with a live cookie reads
 * as signed out. Pass the request from a middleware or a route handler; a
 * page or an action calls it bare and the ambient request is used.
 */
export async function requireUser(req?: Request): Promise<User | null> {
  const session = await auth(req);
  const githubId = Number(session?.user?.id);
  if (!Number.isInteger(githubId)) return null;
  return (await db.query.users.findFirst({ where: { githubId } })) ?? null;
}

/**
 * What an action returns to a caller with no session. An action must RETURN
 * this rather than throw: a throw inside an action is sanitized to a generic
 * 500, which loses the status the caller needed.
 */
export function signedOut(): ActionResult<never> & { success: false } {
  return { success: false, error: 'Sign in to continue.', status: 401 };
}

/**
 * What an action returns for a row that is not the caller's. A 404 and never
 * a 403, so an id that belongs to someone else reads exactly like one that
 * does not exist.
 */
export function notYours(what: string): ActionResult<never> & { success: false } {
  return { success: false, error: `Unknown ${what}.`, status: 404 };
}

/** One cookie's decoded value off a request, or null. */
export function readCookie(req: Request | null | undefined, name: string): string | null {
  const header = req?.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
