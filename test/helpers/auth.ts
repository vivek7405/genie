// A signed-in user for a handle() test: a users row plus the genuine cookie
// the framework reads, minted with the same HS256 JWT it writes. Signing the
// token here rather than driving GitHub keeps the tests offline; the payload
// mirrors what auth.server.ts's jwt callback puts on the cookie.
import { withRequest } from '@webjsdev/server';
import { db } from './db.ts';
import { users } from '#db/schema.server.ts';
import type { User } from '#db/schema.server.ts';

const enc = new TextEncoder();
let nextId = 1000;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
}

export async function sessionCookieFor(user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: String(user.githubId), name: user.name, email: null, image: user.avatarUrl, login: user.login, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(process.env.AUTH_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(unsigned));
  return `webjs.auth=${encodeURIComponent(`${unsigned}.${b64url(sig)}`)}`;
}

/** The users row for a login (created on first use) and its session cookie. */
export async function signInAs(login: string): Promise<{ user: User; cookies: string }> {
  const user = (await db.query.users.findFirst({ where: { login } }))
    ?? (await db.insert(users).values({ githubId: nextId++, login, name: login, avatarUrl: null }).returning())[0];
  return { user, cookies: await sessionCookieFor(user) };
}

/** Run a direct action or query call as this session, the way a request would. */
export function actingAs<T>(cookies: string, fn: () => Promise<T>): Promise<T> {
  return withRequest(new Request('http://localhost/', { headers: { cookie: cookies } }), fn);
}
