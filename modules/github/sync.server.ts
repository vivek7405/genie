// Server-only: the GitHub-to-genie direction plus the reconciliation pass,
// every GENIE_SYNC_MS per project. One GraphQL request (the board items) and
// one REST request (the genie-labeled issues) per project per tick, one more
// REST request per task in review (its pull request), plus the few writes a
// tick actually needs.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { projects, tasks } from '#db/schema.server.ts';
import type { Project } from '#modules/projects/types.ts';
import type { Task } from '#modules/tasks/types.ts';
import { notifyBoard, recordEvent } from '#modules/pipeline/events.server.ts';
import { approve, requestChanges } from '#modules/pipeline/verdicts.server.ts';
import { GithubError, describeError } from './client.server.ts';
import { isGenieComment, listComments, listGenieIssues, taskMarker, type Issue } from './issues.server.ts';
import { publishTask } from './mirror.server.ts';
import { listPrReviews, listReviewComments, readPr } from './pr.server.ts';
import { listBoardItems, moveItem, resolveBoard, statusForOption, type BoardItem } from './projects-v2.server.ts';

export const NO_COMMENT_FEEDBACK = 'Moved back to In progress on GitHub without a comment.';
export const NO_REVIEW_FEEDBACK = 'Changes requested on the pull request without a comment.';
// A plain PR comment opening with this is a Request changes verdict; the rest
// of the comment is the feedback.
export const PR_COMMENT_PREFIX = /^\s*GENIE:\s*/;

export interface SyncSummary { imported: number; published: number; verdicts: number; reasserted: number }

// `running`, `lastRunAt` and `lastError` are what GET /health reports (M6).
interface SyncState { timer: ReturnType<typeof setInterval> | null; running: boolean; pausedUntil: number; lastRunAt: Date | null; lastError: string | null }
const g = globalThis as unknown as { __genie_sync?: SyncState };
const state: SyncState = (g.__genie_sync ??= { timer: null, running: false, pausedUntil: 0, lastRunAt: null, lastError: null });

export interface SyncStatus { lastRunAt: Date | null; lastError: string | null; running: boolean }

export function syncStatus(): SyncStatus {
  return { lastRunAt: state.lastRunAt, lastError: state.lastError, running: state.running };
}

// The newest human comment after genie's newest comment, else the fixed text.
export async function latestHumanFeedback(project: Project, issueNumber: number): Promise<string> {
  const comments = await listComments(project, issueNumber);
  const lastGenie = comments.map((c) => isGenieComment(c.body)).lastIndexOf(true);
  const human = comments.slice(lastGenie + 1).filter((c) => !isGenieComment(c.body)).at(-1);
  return human?.body.trim().slice(0, 4000) || NO_COMMENT_FEEDBACK;
}

export type PrVerdict = { kind: 'approve'; note: string } | { kind: 'changes'; feedback: string } | null;

// When the task entered its current status: its newest status event.
async function enteredStatusAt(task: Task): Promise<number> {
  const event = await db.query.taskEvents.findFirst({ where: { taskId: task.id, kind: 'status' }, orderBy: { createdAt: 'desc' } });
  return (event?.createdAt ?? task.createdAt).getTime();
}

// The verdict a human gave on the pull request since the task entered review,
// newest signal first: a merge, an APPROVED or CHANGES_REQUESTED review, or a
// PR comment starting with GENIE:. A COMMENTED review and a lone inline
// thread are not verdicts. One request per tick while the PR is quiet:
// reviews and comments are read only when the PR changed since the last sync.
export async function prVerdict(project: Project, task: Task): Promise<PrVerdict> {
  if (task.prNumber == null) return null;
  const pr = await readPr(project, task.prNumber);
  if (pr.mergedAt) return { kind: 'approve', note: `Merged on GitHub: ${pr.htmlUrl}` };
  // GitHub's timestamps are whole seconds, so anything from the same second
  // as the last sync counts as newer.
  if (task.syncedAt && Date.parse(pr.updatedAt) + 1000 <= task.syncedAt.getTime()) return null;
  const since = await enteredStatusAt(task);
  const signals: { at: number; verdict: NonNullable<PrVerdict> | (() => Promise<NonNullable<PrVerdict>>) }[] = [];
  for (const review of await listPrReviews(project, task.prNumber)) {
    const at = review.submittedAt ? Date.parse(review.submittedAt) : 0;
    if (at <= since) continue;
    if (review.state === 'APPROVED') signals.push({ at, verdict: { kind: 'approve', note: `Approved on GitHub: ${review.htmlUrl}` } });
    if (review.state === 'CHANGES_REQUESTED') {
      const prNumber = task.prNumber;
      signals.push({ at, verdict: async () => {
        const inline = (await listReviewComments(project, prNumber)).filter((c) => c.reviewId === review.id);
        const lines = inline.map((c) => `- ${c.path}${c.line != null ? `:${c.line}` : ''}: ${c.body.trim()}`);
        const feedback = [review.body.trim(), ...lines].filter(Boolean).join('\n\n');
        return { kind: 'changes', feedback: feedback.slice(0, 4000) || NO_REVIEW_FEEDBACK };
      } });
    }
  }
  for (const comment of await listComments(project, task.prNumber)) {
    const at = Date.parse(comment.createdAt);
    if (at <= since || isGenieComment(comment.body) || !PR_COMMENT_PREFIX.test(comment.body)) continue;
    const feedback = comment.body.replace(PR_COMMENT_PREFIX, '').trim().slice(0, 4000);
    signals.push({ at, verdict: { kind: 'changes', feedback: feedback || NO_REVIEW_FEEDBACK } });
  }
  const newest = signals.sort((a, b) => b.at - a.at)[0];
  if (!newest) {
    // Nothing to do: remember the look so a quiet PR costs one request next tick.
    await db.update(tasks).set({ syncedAt: new Date() }).where(eq(tasks.id, task.id));
    return null;
  }
  return typeof newest.verdict === 'function' ? newest.verdict() : newest.verdict;
}

export async function syncProject(input: Project): Promise<SyncSummary> {
  const summary: SyncSummary = { imported: 0, published: 0, verdicts: 0, reasserted: 0 };
  let project = input;
  try {
    if (project.githubProjectNumber && !project.githubProjectId) project = await resolveBoard(project);
    const issues = await listGenieIssues(project);
    const board = project.githubProjectId ? await listBoardItems(project) : { items: [], truncated: false };
    if (board.truncated && !project.syncError) console.warn(`[genie] board for ${project.githubRepo} has more than 100 items, only the first page is synced`);
    const itemByIssue = new Map<number, BoardItem>();
    for (const item of board.items) if (item.issueNumber != null) itemByIssue.set(item.issueNumber, item);
    const rows = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    const taskByIssue = new Map<number, Task>();
    for (const t of rows) if (t.githubIssueNumber != null) taskByIssue.set(t.githubIssueNumber, t);

    // 1. genie-created tasks whose issue never got opened (or whose link was lost).
    for (const t of rows.filter((r) => r.githubIssueNumber == null)) {
      const existing = issues.find((i) => i.body.includes(taskMarker(t.id)));
      try {
        const linked = await publishTask(project, t, existing);
        taskByIssue.set(linked.githubIssueNumber!, linked);
        notifyBoard(linked);
        summary.published++;
      } catch (err) {
        await recordEvent(t.id, 'github', `Publishing to GitHub failed, will retry: ${describeError(err)}`);
      }
    }

    // 2. genie-labeled issues genie does not know: import when in Todo (or no board).
    for (const issue of issues) {
      if (taskByIssue.has(issue.number)) continue;
      const item = itemByIssue.get(issue.number);
      if (project.githubProjectId && (!item || statusForOption(project, item.optionId) !== 'todo')) continue;
      await importIssue(project, issue, item ?? null);
      summary.imported++;
    }

    // 3. linked tasks: verdicts for ready_for_review (the card, then the pull
    // request), re-assert genie-owned states.
    for (const [number, task] of taskByIssue) {
      const item = itemByIssue.get(number);
      if (item && item.itemId !== task.githubItemId) await db.update(tasks).set({ githubItemId: item.itemId }).where(eq(tasks.id, task.id));
      const boardStatus = item ? statusForOption(project, item.optionId) : null;
      if (item && boardStatus !== null && boardStatus !== task.status) {
        if (task.status === 'ready_for_review' && boardStatus === 'done') {
          await approve(task.id, 'Approved on GitHub');
          summary.verdicts++;
          continue;
        }
        if (task.status === 'ready_for_review' && boardStatus === 'in_progress') {
          await requestChanges(task.id, await latestHumanFeedback(project, number), 'github');
          summary.verdicts++;
          continue;
        }
        if (task.status === 'planning' || task.status === 'in_progress' || task.status === 'ready_for_review') {
          await moveItem(project, item.itemId, task.status);
          await recordEvent(task.id, 'github', `Card moved to ${boardStatus} on GitHub, moved back: genie owns this stage`);
          summary.reasserted++;
        }
      }
      if (task.status === 'ready_for_review' && task.prNumber != null) {
        const verdict = await prVerdict(project, task);
        if (verdict?.kind === 'approve') await approve(task.id, verdict.note);
        else if (verdict?.kind === 'changes') await requestChanges(task.id, verdict.feedback, 'github');
        if (verdict) summary.verdicts++;
      }
    }

    await db.update(projects).set({ syncError: null, syncedAt: new Date() }).where(eq(projects.id, project.id));
  } catch (err) {
    if (err instanceof GithubError && (err.status === 403 || err.status === 429) && err.resetAt) state.pausedUntil = err.resetAt.getTime();
    state.lastError = `${project.githubRepo}: ${describeError(err)}`;
    await db.update(projects).set({ syncError: describeError(err) }).where(eq(projects.id, project.id));
    console.warn(`[genie] sync failed for ${state.lastError}`);
  }
  return summary;
}

// onConflictDoNothing() is what makes a race between createTask and an import
// harmless under the (project_id, github_issue_number) unique index.
async function importIssue(project: Project, issue: Issue, item: BoardItem | null): Promise<void> {
  const [row] = await db
    .insert(tasks)
    .values({ projectId: project.id, githubIssueNumber: issue.number, githubItemId: item?.itemId ?? null, title: issue.title, description: issue.body, syncedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (!row) return;
  await recordEvent(row.id, 'github', `Imported from issue #${issue.number} ${issue.htmlUrl}`);
  notifyBoard(row);
}

export async function syncAll(): Promise<void> {
  if (state.running || Date.now() < state.pausedUntil) return;
  state.running = true;
  state.lastError = null;
  try {
    for (const project of await db.query.projects.findMany()) await syncProject(project);
  } finally {
    state.running = false;
    state.lastRunAt = new Date();
  }
}

export function startSync(opts: { intervalMs?: number } = {}): void {
  if (state.timer) return;
  const intervalMs = opts.intervalMs ?? Number(process.env.GENIE_SYNC_MS ?? 30_000);
  state.timer = setInterval(() => { void syncAll(); }, intervalMs);
  state.timer.unref?.();
  void syncAll();
}

// Also called by M6's SIGTERM handler.
export function stopSync(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}
