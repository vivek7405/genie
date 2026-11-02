// Server-only: who owns GH_TOKEN. Genie is single tenant: every repository call
// and every push acts as this person, so nobody else may sign in.
import { ghApi } from './client.server.ts';

let cached: string | null = null;

export async function operatorLogin(): Promise<string> {
  cached ??= (await ghApi<{ login: string }>('user')).login;
  return cached;
}

// Test seam.
export function resetOperatorLogin(): void {
  cached = null;
}
