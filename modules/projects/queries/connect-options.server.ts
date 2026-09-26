'use server';
// What the connect page has to offer, in one shape per state. Reads the
// signed-in person's installations, repositories and boards with their own
// token; the token itself never leaves the server (the shape below carries
// none of it).
import type { User } from '#db/schema.server.ts';
import { currentUser } from '#modules/auth/queries/current-user.server.ts';
import { describeError } from '#modules/github/client.server.ts';
import { githubAppConfigured, installUrl, installationRepos, userBoards, userInstallations, type Board, type Installation, type InstallationRepo } from '#modules/github/app.server.ts';

export interface InstallationWithRepos extends Installation { repos: InstallationRepo[] }
export interface PickedRepo { fullName: string; owner: string; installationId: number; defaultBranch: string }

export type ConnectOptions =
  // No GitHub App on this server: the operator form (owner/name and a board number).
  | { mode: 'operator' }
  | { mode: 'signed-out' }
  // The App is not installed anywhere this person can reach.
  | { mode: 'install'; installUrl: string }
  // A repository picker, and once one is picked, the boards under its owner
  // with the ones linked to it first. `unknownRepo` is a ?repo= nothing
  // offered, `justInstalled` the account of the installation GitHub just
  // returned from (?installation_id=).
  | { mode: 'pick'; installUrl: string; installations: InstallationWithRepos[]; repo: PickedRepo | null; boards: Board[]; unknownRepo: string | null; justInstalled: string | null }
  | { mode: 'error'; message: string };

export interface ConnectQuery { repo?: string; installation_id?: string }

const linkedFirst = (boards: Board[], fullName: string): Board[] => {
  const linked = (b: Board) => b.repos.some((r) => r.toLowerCase() === fullName.toLowerCase());
  return [...boards.filter(linked), ...boards.filter((b) => !linked(b))];
};

export async function connectOptions(query: ConnectQuery): Promise<ConnectOptions> {
  if (!githubAppConfigured()) return { mode: 'operator' };
  const user: User | null = await currentUser();
  if (!user) return { mode: 'signed-out' };
  try {
    const installations = (await userInstallations(user)).filter((i) => !i.suspended);
    if (installations.length === 0) return { mode: 'install', installUrl: installUrl() };
    const withRepos: InstallationWithRepos[] = await Promise.all(installations.map(async (i) => ({ ...i, repos: await installationRepos(i.id, user) })));
    const wanted = (query.repo ?? '').trim().toLowerCase();
    let repo: PickedRepo | null = null;
    for (const i of withRepos) {
      const hit = i.repos.find((r) => r.fullName.toLowerCase() === wanted);
      if (hit) repo = { fullName: hit.fullName, owner: hit.fullName.split('/')[0], installationId: i.id, defaultBranch: hit.defaultBranch };
    }
    const boards = repo ? linkedFirst(await userBoards(user, repo.owner), repo.fullName) : [];
    const returned = Number(query.installation_id);
    const justInstalled = installations.find((i) => i.id === returned)?.account ?? null;
    return { mode: 'pick', installUrl: installUrl(), installations: withRepos, repo, boards, unknownRepo: wanted && !repo ? query.repo!.trim() : null, justInstalled };
  } catch (err) {
    return { mode: 'error', message: describeError(err) };
  }
}
