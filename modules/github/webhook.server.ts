// Server-only: the GitHub App webhook, the instant half of the sync. A
// delivery never does the work in the request: it names the connected
// projects the event touches and asks the sync loop for a run, which is
// what the 30 s poll would have found later anyway. Nothing here logs a
// body, a header or the secret.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '#db/connection.server.ts';
import { requestSync } from './sync.server.ts';

const SIGNATURE_PREFIX = 'sha256=';

// The `x-hub-signature-256` check: HMAC-SHA256 of the raw body under the
// App's webhook secret, compared in constant time. Missing pieces fail.
export function verifySignature(rawBody: string, header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(SIGNATURE_PREFIX + createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// What a delivery means for the sync. `repo` is the repository's full name
// (owner/name) when the payload carries one, `board` the Projects v2 node id
// for a board event, and `reason` a short label for the log line.
export interface Delivery { repo: string | null; board: string | null; reason: string }

interface Payload {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: { merged?: boolean };
  projects_v2_item?: { project_node_id?: string };
}

const ISSUE_ACTIONS = new Set(['opened', 'labeled', 'reopened', 'edited', 'closed']);

// The events and actions that carry a signal the sync reads: a new or
// relabeled issue, a comment (a GENIE: verdict), a review, a merge or a
// push to the PR, a card move. Everything else is null, answered 204.
export function classify(event: string, payload: unknown): Delivery | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Payload;
  const action = typeof p.action === 'string' ? p.action : '';
  const repo = typeof p.repository?.full_name === 'string' ? p.repository.full_name : null;
  const hit = (reason: string): Delivery => ({ repo, board: null, reason });
  switch (event) {
    case 'ping':
      return { repo: null, board: null, reason: 'ping' };
    case 'issues':
      return ISSUE_ACTIONS.has(action) ? hit(`issues.${action}`) : null;
    case 'issue_comment':
      return action === 'created' ? hit('issue_comment.created') : null;
    case 'pull_request_review':
      return action === 'submitted' ? hit('pull_request_review.submitted') : null;
    case 'pull_request':
      if (action === 'closed' && p.pull_request?.merged === true) return hit('pull_request.merged');
      if (action === 'synchronize') return hit('pull_request.synchronize');
      return null;
    case 'projects_v2_item': {
      const board = typeof p.projects_v2_item?.project_node_id === 'string' ? p.projects_v2_item.project_node_id : null;
      return { repo, board, reason: `projects_v2_item.${action || 'unknown'}` };
    }
    default:
      return null;
  }
}

type Scheduler = (projectId: string) => void;
let scheduler: Scheduler = (projectId) => requestSync(projectId);

// A test seam: observe what a delivery schedules without running a sync.
export function setSyncScheduler(fn: Scheduler | null): void {
  scheduler = fn ?? ((projectId) => requestSync(projectId));
}

// Schedule a sync for every connected project the delivery touches, matched
// by repository name (case-insensitive, GitHub treats names that way) or by
// the board's node id. Returns how many were scheduled.
export async function handleDelivery(event: string, payload: unknown): Promise<number> {
  const hit = classify(event, payload);
  if (!hit || (!hit.repo && !hit.board)) return 0;
  const repo = hit.repo?.toLowerCase() ?? null;
  const matches = (await db.query.projects.findMany()).filter(
    (project) => (repo !== null && project.githubRepo.toLowerCase() === repo) || (hit.board !== null && project.githubProjectId === hit.board),
  );
  for (const project of matches) scheduler(project.id);
  if (matches.length > 0) console.log(`[genie] webhook ${hit.reason} for ${hit.repo ?? hit.board}: sync requested for ${matches.length} project(s)`);
  return matches.length;
}
