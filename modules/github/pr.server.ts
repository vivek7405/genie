// Server-only: what genie reads off a pull request. The pilots GitHub App
// upserts one comment per PR (marker on the first line, then "Preview for
// `sha`: url") and sets a commit status on the head sha with context
// pilots/deploy and target_url = the preview. Reviews and review comments
// are read so a verdict given on the PR reaches the sync (issue #2).
import type { Project } from '#modules/projects/types.ts';
import { ghApi } from './client.server.ts';
import { listComments } from './issues.server.ts';

export const PREVIEW_MARKER = '<!-- pilots-preview -->';
export const PREVIEW_STATUS_CONTEXT = 'pilots/deploy';
const PREVIEW_LINE = /Preview for `([0-9a-f]+)`: (https:\/\/\S+)/;

interface RestPull { number: number; state: 'open' | 'closed'; merged: boolean; merged_at: string | null; updated_at: string; html_url: string; head: { sha: string; ref: string } }
interface RestCombinedStatus { statuses: { context: string; state: string; target_url: string | null }[] }
interface RestReview { id: number; state: string; body: string | null; user: { login: string } | null; submitted_at: string | null; html_url: string }
interface RestReviewComment { id: number; pull_request_review_id: number | null; path: string; line: number | null; original_line: number | null; body: string; user: { login: string } | null; created_at: string; html_url: string }

export interface PullRequest { number: number; state: 'open' | 'closed'; merged: boolean; mergedAt: string | null; updatedAt: string; htmlUrl: string; headSha: string; headRef: string }
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
export interface PrReview { id: number; state: ReviewState; body: string; author: string; submittedAt: string | null; htmlUrl: string }
export interface ReviewComment { id: number; reviewId: number | null; path: string; line: number | null; body: string; author: string; createdAt: string; htmlUrl: string }

const toPull = (p: RestPull): PullRequest => ({ number: p.number, state: p.state, merged: p.merged, mergedAt: p.merged_at, updatedAt: p.updated_at, htmlUrl: p.html_url, headSha: p.head.sha, headRef: p.head.ref });
const toReview = (r: RestReview): PrReview => ({ id: r.id, state: r.state as ReviewState, body: r.body ?? '', author: r.user?.login ?? '', submittedAt: r.submitted_at, htmlUrl: r.html_url });
const toReviewComment = (c: RestReviewComment): ReviewComment => ({ id: c.id, reviewId: c.pull_request_review_id, path: c.path, line: c.line ?? c.original_line, body: c.body, author: c.user?.login ?? '', createdAt: c.created_at, htmlUrl: c.html_url });

export interface PreviewOptions { sha?: string }

// The preview URL for one commit of the PR, or null while pilots is still
// building it. The commit is `sha` when given (a revision round: the preview
// keeps its pr-<N>-<service> URL across pushes, so only the sha tells rounds
// apart), else the PR's current head. The comment is checked against that
// sha, so a push pilots has not rebuilt yet reads as "not ready", never as a
// stale URL.
export async function findPreviewUrl(project: Project, prNumber: number, opts: PreviewOptions = {}): Promise<string | null> {
  const pr = await ghApi<RestPull>(`repos/${project.githubRepo}/pulls/${prNumber}`);
  const sha = opts.sha ?? pr.head.sha;
  const comments = await listComments(project, prNumber);
  const preview = comments.filter((c) => c.body.includes(PREVIEW_MARKER)).at(-1);
  const match = preview?.body.match(PREVIEW_LINE);
  if (match && sha.startsWith(match[1])) return match[2];
  const combined = await ghApi<RestCombinedStatus>(`repos/${project.githubRepo}/commits/${sha}/status`);
  const ready = combined.statuses.find((s) => s.context === PREVIEW_STATUS_CONTEXT && s.state === 'success' && s.target_url);
  return ready?.target_url ?? null;
}

// Squash-merge over REST and delete the head branch. Idempotent: an already
// merged PR returns without a second merge call.
export async function mergePr(project: Project, prNumber: number): Promise<{ sha: string | null; merged: boolean }> {
  const pr = await ghApi<RestPull>(`repos/${project.githubRepo}/pulls/${prNumber}`);
  if (pr.merged) return { sha: null, merged: true };
  const result = await ghApi<{ sha: string; merged: boolean }>(`repos/${project.githubRepo}/pulls/${prNumber}/merge`, { method: 'PUT', body: { merge_method: 'squash' } });
  await ghApi<undefined>(`repos/${project.githubRepo}/git/refs/heads/${pr.head.ref}`, { method: 'DELETE' }).catch(() => undefined);
  return result;
}

// One request: the PR's merge state, head and last activity time. The sync
// reads this once per tick for every task in review and fetches reviews and
// comments only when updatedAt moved.
export async function readPr(project: Project, prNumber: number): Promise<PullRequest> {
  return toPull(await ghApi<RestPull>(`repos/${project.githubRepo}/pulls/${prNumber}`));
}

// Submitted reviews, oldest first. A PENDING review (still being written)
// has no submitted_at and is dropped.
export async function listPrReviews(project: Project, prNumber: number): Promise<PrReview[]> {
  const rows = await ghApi<RestReview[]>(`repos/${project.githubRepo}/pulls/${prNumber}/reviews?per_page=100`);
  return rows.filter((r) => r.state !== 'PENDING' && r.submitted_at).map(toReview);
}

// Inline (diff-anchored) comments on the PR, oldest first, each carrying the
// id of the review it was submitted with.
export async function listReviewComments(project: Project, prNumber: number): Promise<ReviewComment[]> {
  const rows = await ghApi<RestReviewComment[]>(`repos/${project.githubRepo}/pulls/${prNumber}/comments?per_page=100`);
  return rows.map(toReviewComment);
}
