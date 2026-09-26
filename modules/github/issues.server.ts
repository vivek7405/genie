// Server-only: issues, labels and comments over REST. The `genie` label is the
// opt-in: only labeled issues are imported or automated, and issues genie
// creates carry it from the start.
import type { Project } from '#modules/projects/types.ts';
import { ghApi, GithubError } from './client.server.ts';

export const GENIE_LABEL = 'genie';
const LABEL_COLOR = '7c3aed';
const LABEL_DESCRIPTION = 'Automated by genie';

export interface Issue { number: number; nodeId: string; title: string; body: string; state: 'open' | 'closed'; labels: string[]; htmlUrl: string; updatedAt: string }
export interface IssueComment { id: number; body: string; author: string; createdAt: string; htmlUrl: string }

interface RestIssue { number: number; node_id: string; title: string; body: string | null; state: 'open' | 'closed'; labels: { name: string }[]; html_url: string; updated_at: string; pull_request?: unknown }
interface RestComment { id: number; body: string | null; user: { login: string } | null; created_at: string; html_url: string }

const toIssue = (i: RestIssue): Issue => ({ number: i.number, nodeId: i.node_id, title: i.title, body: i.body ?? '', state: i.state, labels: i.labels.map((l) => l.name), htmlUrl: i.html_url, updatedAt: i.updated_at });
const toComment = (c: RestComment): IssueComment => ({ id: c.id, body: c.body ?? '', author: c.user?.login ?? '', createdAt: c.created_at, htmlUrl: c.html_url });

// Markers: every comment genie posts starts with one, and every issue genie
// creates ends with taskMarker(). They are how genie tells its own writes from
// a human's, since both come from the same token. The `genie-<kind>` form is
// shared with the pipeline stages (`<!-- genie-plan -->` in M4). The `genie:`
// spelling is recognised as well.
const GENIE_MARKER = /^\s*<!--\s*genie[-:]/;
export const commentMarker = (kind: string): string => `<!-- genie-${kind} -->`;
export const taskMarker = (taskId: string): string => `<!-- genie-task ${taskId} -->`;
export const isGenieComment = (body: string): boolean => GENIE_MARKER.test(body);

const labeled = new Set<string>();

async function ensureGenieLabel(project: Project): Promise<void> {
  if (labeled.has(project.githubRepo)) return;
  try {
    await ghApi<unknown>(`repos/${project.githubRepo}/labels/${GENIE_LABEL}`);
  } catch (err) {
    if (!(err instanceof GithubError) || err.status !== 404) throw err;
    await ghApi<unknown>(`repos/${project.githubRepo}/labels`, { method: 'POST', body: { name: GENIE_LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION } });
  }
  labeled.add(project.githubRepo);
}

export async function createIssue(project: Project, input: { title: string; body: string }): Promise<Issue> {
  await ensureGenieLabel(project);
  const created = await ghApi<RestIssue>(`repos/${project.githubRepo}/issues`, { method: 'POST', body: { title: input.title, body: input.body, labels: [GENIE_LABEL] } });
  return toIssue(created);
}

export async function commentOnIssue(project: Project, issueNumber: number, body: string): Promise<{ id: number; htmlUrl: string }> {
  const c = await ghApi<RestComment>(`repos/${project.githubRepo}/issues/${issueNumber}/comments`, { method: 'POST', body: { body } });
  return { id: c.id, htmlUrl: c.html_url };
}

export async function readIssue(project: Project, issueNumber: number): Promise<Issue> {
  return toIssue(await ghApi<RestIssue>(`repos/${project.githubRepo}/issues/${issueNumber}`));
}

// Open issues carrying the genie label. The endpoint returns pull requests
// too (gh-budget trap 1), so those are dropped here.
export async function listGenieIssues(project: Project): Promise<Issue[]> {
  const rows = await ghApi<RestIssue[]>(`repos/${project.githubRepo}/issues?labels=${GENIE_LABEL}&state=open&per_page=100`);
  return rows.filter((r) => !r.pull_request).map(toIssue);
}

// Oldest first, as GitHub returns them. PR comments live on the same route.
export async function listComments(project: Project, issueNumber: number): Promise<IssueComment[]> {
  const rows = await ghApi<RestComment[]>(`repos/${project.githubRepo}/issues/${issueNumber}/comments?per_page=100`);
  return rows.map(toComment);
}
