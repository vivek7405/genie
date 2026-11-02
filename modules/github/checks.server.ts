// Server-only: what GitHub says about a commit, for the CI gate and the preview.
import type { CiStatus } from '#modules/tasks/types.ts';
import { ghApi } from './client.server.ts';

// The Pilots GitHub App reports its preview through this status, and through one
// comment per pull request. A preview still building is not a CI result.
export const PREVIEW_STATUS_CONTEXT = 'pilots/deploy';
export const PREVIEW_MARKER = '<!-- pilots-preview -->';
const PREVIEW_LINE = /Preview for `([0-9a-f]+)`: (https:\/\/\S+)/;

export interface RestCheckRun { name: string; status: string; conclusion: string | null; html_url: string | null }
export interface RestStatus { context: string; state: string; target_url: string | null }

export interface FailedCheck { name: string; url: string }
export interface CheckSummary { state: Exclude<CiStatus, 'pending'> | 'pending'; failed: FailedCheck[] }

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

// A failure decides at once, since waiting for the rest changes nothing. Neutral and
// skipped runs pass: a path filter skipping a job is not a problem with the code.
export function summarizeChecks(runs: readonly RestCheckRun[], statuses: readonly RestStatus[]): CheckSummary {
  const failed: FailedCheck[] = [];
  let pending = false;
  for (const run of runs) {
    if (run.status !== 'completed') pending = true;
    else if (run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion)) failed.push({ name: run.name, url: run.html_url ?? '' });
  }
  const others = statuses.filter((s) => s.context !== PREVIEW_STATUS_CONTEXT);
  for (const status of others) {
    if (status.state === 'pending') pending = true;
    else if (status.state !== 'success') failed.push({ name: status.context, url: status.target_url ?? '' });
  }
  if (failed.length) return { state: 'failing', failed };
  if (pending) return { state: 'pending', failed };
  return { state: runs.length + others.length === 0 ? 'none' : 'passing', failed };
}

export async function readChecks(repo: string, sha: string): Promise<CheckSummary> {
  const [{ check_runs: runs }, { statuses }] = await Promise.all([
    ghApi<{ check_runs: RestCheckRun[] }>(`repos/${repo}/commits/${sha}/check-runs?per_page=100`),
    ghApi<{ statuses: RestStatus[] }>(`repos/${repo}/commits/${sha}/status`),
  ]);
  return summarizeChecks(runs, statuses);
}

// The preview of exactly this commit, or null while Pilots is still building it.
// The URL is the same across pushes, so only the sha tells a stale one apart.
export async function findPilotsPreview(repo: string, prNumber: number, sha: string): Promise<string | null> {
  const comments = await ghApi<{ body: string }[]>(`repos/${repo}/issues/${prNumber}/comments?per_page=100`);
  const match = comments.filter((c) => c.body.includes(PREVIEW_MARKER)).at(-1)?.body.match(PREVIEW_LINE);
  if (match && sha.startsWith(match[1])) return match[2];
  const { statuses } = await ghApi<{ statuses: RestStatus[] }>(`repos/${repo}/commits/${sha}/status`);
  return statuses.find((s) => s.context === PREVIEW_STATUS_CONTEXT && s.state === 'success' && s.target_url)?.target_url ?? null;
}
