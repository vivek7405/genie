'use server';
// Whether the request carries a session: a cookie read, no database. For
// the public site's header, which ships to the browser and so reaches the
// session over RPC. POST-default, so the per-visitor answer is never cached.
import { auth } from '../auth.server.ts';

export async function signedIn(): Promise<boolean> {
  return Boolean((await auth())?.user);
}
