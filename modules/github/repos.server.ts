// Server-only: reading repositories with the operator's token.
import { GithubError, ghApi } from './client.server.ts';

interface RestRepo { full_name: string; default_branch: string; archived: boolean; permissions?: { push?: boolean } }

export interface RepoInfo { fullName: string; defaultBranch: string; canPush: boolean; archived: boolean; empty: boolean }

export async function readRepo(repo: string): Promise<RepoInfo> {
  const r = await ghApi<RestRepo>(`repos/${repo}`);
  // GitHub answers 409 for the commits of a repository with none.
  const empty = await ghApi(`repos/${r.full_name}/commits?per_page=1`).then(() => false, (err: unknown) => {
    if (err instanceof GithubError && err.status === 409) return true;
    throw err;
  });
  return { fullName: r.full_name, defaultBranch: r.default_branch, canPush: r.permissions?.push === true, archived: r.archived, empty };
}

// Newest pushes first: what the connect form suggests. One page is plenty, since
// any repository can still be typed by hand.
export async function listRepoNames(): Promise<string[]> {
  const rows = await ghApi<RestRepo[]>('user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member');
  return rows.filter((r) => !r.archived && r.permissions?.push === true).map((r) => r.full_name);
}
