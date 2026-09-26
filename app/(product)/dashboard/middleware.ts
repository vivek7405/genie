// The protected-route gate. Runs for every request under /dashboard/*: with
// no valid session a page render is sent to sign in BEFORE anything is
// produced, and a write (a form-bound action posting to a dashboard path)
// is answered with the ActionResult failure an action would return itself.
// A cookie read, no database, so the gate is real the moment the app boots.
//
// RPC actions post to /__webjs/action/*, outside this segment, so every
// action under modules/projects and modules/tasks ALSO checks requireUser()
// itself; this gate is the page-level half.
import { auth } from '#modules/auth/auth.server.ts';

export default async function requireAuth(req: Request, next: () => Promise<Response>) {
  const session = await auth(req);
  if (session?.user) return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    const { pathname, search } = new URL(req.url);
    const back = pathname === '/dashboard' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return new Response(null, { status: 302, headers: { location: `/login${back}` } });
  }
  return Response.json({ success: false, error: 'Sign in to continue.', status: 401 }, { status: 401 });
}
