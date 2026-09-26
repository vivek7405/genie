'use server';
// The signed-in person as the chrome shows them: login, name, picture. A
// `'use server'` query, because a layout ships to the browser and may only
// reach the session over RPC. It carries NO access token: that stays on
// `currentUser()`, the server-only read. POST-default on purpose (no
// `method` export), so a per-session answer never lands in a cache.
import { requireUser } from '../session.server.ts';

export interface Account {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export async function account(): Promise<Account | null> {
  const user = await requireUser();
  if (!user) return null;
  return { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl };
}
