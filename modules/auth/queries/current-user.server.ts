// Server-only: who is signed in. A placeholder until sign-in lands (#32):
// GENIE_DEV_USER_LOGIN names a users row to act as in development, and
// without it nobody is signed in. Deliberately NOT a 'use server' query: the
// row carries the person's GitHub access token, which must never be
// reachable over RPC. Pages, actions and route handlers call it directly.
import { db } from '#db/connection.server.ts';
import type { User } from '#db/schema.server.ts';

export async function currentUser(): Promise<User | null> {
  const login = process.env.GENIE_DEV_USER_LOGIN;
  if (!login) return null;
  return (await db.query.users.findFirst({ where: { login } })) ?? null;
}
