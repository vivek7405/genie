// The signed-in user's `users` row, for a page, an action or a route handler
// to await, and for the GitHub module to read the user-to-server token from.
//
// Deliberately NOT a `'use server'` file: the row carries `accessToken`, and
// a `'use server'` export is an RPC endpoint any browser could POST to. As a
// server-only utility it is reachable from server code only, never from
// anything that ships to the browser (a layout reads `account()` instead).
import type { User } from '#db/schema.server.ts';
import { requireUser } from '../session.server.ts';

export async function currentUser(): Promise<User | null> {
  return requireUser();
}
