// A visitor who is already signed in has no reason to see the sign-in page,
// so send them to the dashboard. A cookie read, no database, before the
// page renders.
import { auth } from '#modules/auth/auth.server.ts';

export default async function redirectIfSignedIn(req: Request, next: () => Promise<Response>) {
  const session = await auth(req);
  if (session?.user) return new Response(null, { status: 302, headers: { location: '/dashboard' } });
  return next();
}
