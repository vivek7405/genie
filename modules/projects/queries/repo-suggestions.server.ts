'use server';
import { requireUser } from '#modules/auth/session.server.ts';
import { listRepoNames } from '#modules/github/repos.server.ts';

export const method = 'GET';

// A convenience for the connect form: GitHub being down must not break the page.
export async function repoSuggestions(): Promise<string[]> {
  if (!(await requireUser())) return [];
  return listRepoNames().catch(() => []);
}
