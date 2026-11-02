// Server-only: who owns GH_TOKEN. Genie is single tenant: every repository call
// and every push acts as this person, so nobody else may sign in, and that person
// is who the signed-in user always is.
import { ghApi } from './client.server.ts';

export interface Operator {
  id: number;
  login: string;
  name: string | null;
}

let cached: Operator | null = null;

export async function operator(): Promise<Operator> {
  cached ??= await ghApi<Operator>('user');
  return cached;
}

export async function operatorLogin(): Promise<string> {
  return (await operator()).login;
}

// The git author for this person's commits. GitHub links its id+login noreply
// address to their account without exposing a private email. An address made up
// here would be attributed to whoever owns that name on GitHub.
export function commitIdentity(who: Operator): { name: string; email: string } {
  return { name: who.name || who.login, email: `${who.id}+${who.login}@users.noreply.github.com` };
}

// Test seam.
export function resetOperatorLogin(): void {
  cached = null;
}
