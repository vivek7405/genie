// Server-only: the GitHub App. Genie acts on GitHub as the App (installation
// tokens for a project's repository and board, minted from the App JWT and
// cached in client.server.ts), and reads what GitHub only answers per person
// (installations, repositories, boards) with the signed-in user's own token.
// Everything here is what the connect flow and the task machines need; the
// per-call credential rule itself is the TokenSource in client.server.ts.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { projects } from '#db/schema.server.ts';
import type { Project, User } from '#db/schema.server.ts';
import { GithubError, ghApi, ghGraphql, githubAppConfigured, installationToken, viaUser } from './client.server.ts';
import { resolveBoard } from './projects-v2.server.ts';

export { appJwt, githubAppConfigured, installationToken } from './client.server.ts';

// Where a person installs the App. GitHub returns them to the App's Setup URL
// (the connect page) with ?installation_id=... once they have.
export function installUrl(): string {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) throw new GithubError('GITHUB_APP_SLUG is not set.', 500);
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}

export interface Installation { id: number; account: string; accountType: 'User' | 'Organization'; suspended: boolean }
export interface InstallationRepo { fullName: string; private: boolean; defaultBranch: string }
export interface Board { id: string; number: number; title: string; url: string; repos: string[] }

interface RestInstallation { id: number; account: { login: string; type: string } | null; suspended_at: string | null }
interface RestRepo { full_name: string; private: boolean; default_branch: string }

const PAGE = 100;
const MAX_PAGES = 10;

// The installations of the App this person can reach, on their own account
// and the organisations they belong to. Not cached: a person lands back on
// the connect page the moment they installed, and a stale list would tell
// them the install did not take.
export async function userInstallations(user: User): Promise<Installation[]> {
  const out: Installation[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await ghApi<{ installations: RestInstallation[] }>(`user/installations?per_page=${PAGE}&page=${page}`, { auth: viaUser(user) });
    out.push(...body.installations.map((i) => ({
      id: i.id, account: i.account?.login ?? '', accountType: i.account?.type === 'Organization' ? 'Organization' as const : 'User' as const, suspended: Boolean(i.suspended_at),
    })));
    if (body.installations.length < PAGE) break;
  }
  return out;
}

// The repositories one installation grants that this person can also see,
// as owner/name. Read with the user's token so a person can only ever pick
// from installations they belong to; the connect action checks the picked
// repository against this list for the same reason.
export async function installationRepos(installationId: number, user: User): Promise<InstallationRepo[]> {
  const out: InstallationRepo[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await ghApi<{ repositories: RestRepo[] }>(`user/installations/${installationId}/repositories?per_page=${PAGE}&page=${page}`, { auth: viaUser(user) });
    out.push(...body.repositories.map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch })));
    if (body.repositories.length < PAGE) break;
  }
  return out;
}

interface BoardNode { id: string; number: number; title: string; url: string; closed: boolean; repositories: { nodes: { nameWithOwner: string }[] } }
interface BoardsQuery { repositoryOwner: { projectsV2: { nodes: BoardNode[] } } | null }

// The boards resolveBoard can find later: `repositoryOwner(owner).projectV2(n)`
// is how a stored board number is looked up, so the boards offered are the
// ones under the repository's owner (the person's own when they own the
// repository, the organisation's otherwise). ProjectV2Owner covers both.
const BOARDS_QUERY = `query($owner: String!) {
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes {
    id number title url closed repositories(first: 20) { nodes { nameWithOwner } } } } } } }`;

const REPO_IDS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id owner { id } } }`;

const CREATE_PROJECT = `mutation($ownerId: ID!, $title: String!) {
  createProjectV2(input: { ownerId: $ownerId, title: $title }) { projectV2 { id number url } } }`;

const LINK_PROJECT = `mutation($projectId: ID!, $repositoryId: ID!) {
  linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) { repository { id } } }`;

// The open boards under `owner`, read as the signed-in person, each with the
// repositories linked to it so the connect page can list the ones linked to
// the chosen repository first.
export async function userBoards(user: User, owner: string): Promise<Board[]> {
  const data = await ghGraphql<BoardsQuery>(BOARDS_QUERY, { owner }, { auth: viaUser(user) });
  const nodes = data.repositoryOwner?.projectsV2.nodes ?? [];
  return nodes.filter((n) => !n.closed).map((n) => ({ id: n.id, number: n.number, title: n.title, url: n.url, repos: n.repositories.nodes.map((r) => r.nameWithOwner) }));
}

// Creates a board under the repository's owner as the signed-in person, links
// the repository to it, stores its number on the project and resolves it
// (resolveBoard adds the Plan and Review columns). Returns the updated row.
export async function createBoard(user: User, project: Project, title: string): Promise<Project> {
  const [owner, name] = project.githubRepo.split('/');
  const ids = await ghGraphql<{ repository: { id: string; owner: { id: string } } | null }>(REPO_IDS_QUERY, { owner, name }, { auth: viaUser(user) });
  if (!ids.repository) throw new GithubError(`${project.githubRepo} was not found on GitHub.`, 404);
  const created = await ghGraphql<{ createProjectV2: { projectV2: { id: string; number: number; url: string } } }>(CREATE_PROJECT, { ownerId: ids.repository.owner.id, title }, { auth: viaUser(user) });
  const board = created.createProjectV2.projectV2;
  await ghGraphql(LINK_PROJECT, { projectId: board.id, repositoryId: ids.repository.id }, { auth: viaUser(user) });
  const [row] = await db.update(projects).set({ githubProjectNumber: board.number }).where(eq(projects.id, project.id)).returning();
  return resolveBoard(row);
}

// The token a task machine acts with for this project: the installation
// token when the App is configured and the project has an installation, else
// the operator's GH_TOKEN, else null (the stage reports what gh says).
export async function repoToken(project: Pick<Project, 'installationId'>): Promise<string | null> {
  if (githubAppConfigured() && project.installationId != null) return installationToken(project.installationId);
  return process.env.GH_TOKEN || null;
}
