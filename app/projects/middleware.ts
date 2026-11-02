// The gate for every product page. A page render goes to sign in; a form post
// gets the failure an action would return. Actions also check for themselves,
// since RPC calls post outside this segment.
import { requireUser } from '#modules/auth/session.server.ts';

export default async function requireAuth(req: Request, next: () => Promise<Response>) {
  if (await requireUser(req)) return next();
  if (req.method === 'GET' || req.method === 'HEAD') return new Response(null, { status: 302, headers: { location: '/' } });
  return Response.json({ success: false, error: 'Sign in to continue.', status: 401 }, { status: 401 });
}
