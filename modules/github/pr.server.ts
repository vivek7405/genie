// Server-only: the pull request a task produced.
import { ghApi } from './client.server.ts';

interface RestPull { number: number; html_url: string; merged: boolean; state: string; head: { ref: string } }

export interface PrRef { number: number; url: string }

export async function findOpenPr(repo: string, branch: string): Promise<PrRef | null> {
  const owner = repo.split('/')[0];
  const rows = await ghApi<RestPull[]>(`repos/${repo}/pulls?state=open&per_page=1&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  return rows[0] ? { number: rows[0].number, url: rows[0].html_url } : null;
}

export async function openPr(repo: string, input: { title: string; head: string; base: string; body: string }): Promise<PrRef> {
  const r = await ghApi<RestPull>(`repos/${repo}/pulls`, { method: 'POST', body: { ...input } });
  return { number: r.number, url: r.html_url };
}

// Squash-merge and delete the branch. Idempotent: a merged PR is left alone. A
// closed one is a real failure, so the card says so instead of claiming a merge.
export async function mergePr(repo: string, prNumber: number): Promise<void> {
  const pr = await ghApi<RestPull>(`repos/${repo}/pulls/${prNumber}`);
  if (pr.merged) return;
  if (pr.state === 'closed') throw new Error(`Pull request #${prNumber} was closed without merging.`);
  await ghApi(`repos/${repo}/pulls/${prNumber}/merge`, { method: 'PUT', body: { merge_method: 'squash' } });
  await ghApi(`repos/${repo}/git/refs/heads/${pr.head.ref}`, { method: 'DELETE' }).catch(() => undefined);
}
