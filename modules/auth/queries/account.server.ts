'use server';
// What the header shows about the person signed in. Public fields only, since
// a 'use server' export is reachable from the browser.
import { requireUser } from '../session.server.ts';

export const method = 'GET';

export interface Account {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export async function account(): Promise<Account | null> {
  const user = await requireUser();
  return user ? { login: user.login, name: user.name, avatarUrl: user.avatarUrl } : null;
}
