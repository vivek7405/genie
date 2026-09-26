/**
 * The auth catch-all. It sits at the APP ROOT because `createAuth` hardcodes
 * `/api/auth/signin/*` and `/api/auth/callback/*`, so the GitHub App's
 * callback URL is `<origin>/api/auth/callback/github` and nothing else.
 *
 * Sign in is a plain `<form method="POST" action="/api/auth/signin/github">`
 * carrying a hidden `redirectTo`; the handler turns it into the OAuth
 * redirect. Sign out is a `<form method="POST">` to `/api/auth/signout`.
 * Both work with JavaScript off.
 *
 * The framework's callback always lands on `/`, which is the marketing site,
 * and its OAuth flow drops `redirectTo` (only the credentials flow reads it).
 * So the target rides a short-lived cookie across the round trip to GitHub
 * and is applied here on the way back. The cookie is client-controlled like
 * any other, so it is checked against the same same-origin rule on BOTH
 * sides: a value that fails is dropped, never repaired.
 */
import { handlers } from '#modules/auth/auth.server.ts';
import { readCookie } from '#modules/auth/session.server.ts';
import { localPath } from '#lib/utils/local-path.ts';

export const NEXT_COOKIE = 'genie_next';
const DASHBOARD = '/dashboard';
const SIGNIN = '/api/auth/signin/';
const CALLBACK = '/api/auth/callback/';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const res = await handlers.GET(req);
  if (url.pathname.startsWith(SIGNIN) && res.status === 302) return carry(res, url.searchParams.get('redirectTo'));
  if (url.pathname.startsWith(CALLBACK) && res.status === 302) return land(req, res);
  return res;
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Read the form BEFORE the framework consumes the body. The OAuth branch
  // never reads it, and the clone keeps the original intact either way.
  const next = url.pathname.startsWith(SIGNIN) ? await formField(req.clone(), 'redirectTo') : null;
  const res = await handlers.POST(req);
  if (next !== null && res.status === 302) return carry(res, next);
  return res;
}

async function formField(req: Request, name: string): Promise<string | null> {
  try {
    const value = (await req.formData()).get(name);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** The redirect to GitHub, plus the cookie that remembers where to land. */
function carry(res: Response, next: string | null): Response {
  const target = localPath(next, '');
  if (!target) return res;
  return withHeaders(res, (h) => h.append('set-cookie', nextCookie(target)));
}

/** The redirect back from GitHub, aimed at the carried target. */
function land(req: Request, res: Response): Response {
  const carried = readCookie(req, NEXT_COOKIE);
  const next = localPath(carried, DASHBOARD);
  return withHeaders(res, (h) => {
    // Only the framework's own landing is overridden. A failed sign-in goes
    // to `pages.error` and keeps going there.
    if (h.get('location') === '/') h.set('location', next);
    if (carried !== null) h.append('set-cookie', clearNextCookie());
  });
}

function nextCookie(next: string): string {
  // Scoped to the auth routes: nothing else reads it, and it expires before
  // the OAuth state cookie does.
  return `${NEXT_COOKIE}=${encodeURIComponent(next)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=300`;
}

function clearNextCookie(): string {
  return `${NEXT_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** A copy of the response with its headers edited; a `Response`'s own are immutable. */
function withHeaders(res: Response, edit: (headers: Headers) => void): Response {
  const headers = new Headers(res.headers);
  edit(headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
