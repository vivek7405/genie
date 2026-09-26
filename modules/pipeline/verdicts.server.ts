// Server-only: the two human verdicts, shared by the genie UI actions and the
// GitHub sync so both entry points behave the same. Approve merges the pull
// request before it moves the card; request changes stores the feedback the
// revise stage will apply. The GitHub and Pilots calls go through `deps`,
// whose test seam is setVerdictDeps().
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { projects, tasks } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import type { Project } from '#modules/projects/types.ts';
import type { Task } from '#modules/tasks/types.ts';
import { describeError } from '#modules/github/client.server.ts';
import { commentMarker, commentOnIssue } from '#modules/github/issues.server.ts';
import { mergePr } from '#modules/github/pr.server.ts';
import { notifyBoard, recordEvent } from './events.server.ts';
import { findProductionUrl } from './production.server.ts';
import { transition } from './transitions.server.ts';

export type VerdictSource = 'genie' | 'github';

export interface VerdictDeps {
  mergePr: (project: Project, prNumber: number) => Promise<{ sha: string | null; merged: boolean }>;
  commentOnIssue: (project: Project, issueNumber: number, body: string) => Promise<unknown>;
  findProductionUrl: (project: Project) => Promise<string | null>;
}

const defaults: VerdictDeps = { mergePr, commentOnIssue, findProductionUrl };
let deps: VerdictDeps = { ...defaults };

// Test seam: swap any dependency, get a restore function back.
export function setVerdictDeps(patch: Partial<VerdictDeps>): () => void {
  const before = deps;
  deps = { ...deps, ...patch };
  return () => { deps = before; };
}

type Outcome = (ActionResult<Task> & { success: true; data: Task }) | (ActionResult<Task> & { success: false });

const who = (source: VerdictSource) => (source === 'github' ? 'on GitHub' : 'in genie');

// Merge first, then move. The claim doubles as the lock: a double submit, or
// a sync tick racing the form, sees 409 instead of merging twice. A merge
// that fails leaves the task in Review with nothing else changed, so the
// human can read the reason and try again. `note` is the feed line for the
// move (the sync passes where the verdict came from); without one the note
// says what the merge did. The machine is not destroyed here: #6's sweep
// owns the one destroy path, so a merged task stays inspectable until then.
export async function approve(taskId: string, note?: string): Promise<Outcome> {
  const [claimed] = await db
    .update(tasks)
    .set({ claimedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'ready_for_review'), isNull(tasks.claimedAt)))
    .returning();
  if (!claimed) {
    const task = await db.query.tasks.findFirst({ where: { id: taskId } });
    if (!task) return { success: false, error: 'Unknown task.', status: 404 };
    if (task.status === 'ready_for_review') return { success: false, error: 'This task is already being merged.', status: 409 };
    return { success: false, error: 'Only a task in Review can be approved.', status: 409 };
  }
  const project = await db.query.projects.findFirst({ where: { id: claimed.projectId } });
  const release = () => db.update(tasks).set({ claimedAt: null }).where(eq(tasks.id, taskId));
  if (!project) {
    await release();
    return { success: false, error: 'Task has no project.', status: 404 };
  }

  if (claimed.prNumber != null) {
    let merged: { sha: string | null; merged: boolean };
    try {
      merged = await deps.mergePr(project, claimed.prNumber);
    } catch (err) {
      const message = describeError(err);
      await release();
      await recordEvent(taskId, 'error', `Merge of PR #${claimed.prNumber} failed: ${message}`);
      notifyBoard(claimed);
      return { success: false, error: `Could not merge PR #${claimed.prNumber}: ${message}`, status: 502 };
    }
    await recordEvent(taskId, 'github', merged.sha
      ? `Merged PR #${claimed.prNumber} into ${project.defaultBranch} (squash, branch deleted)`
      : `PR #${claimed.prNumber} was already merged`);
  }

  const line = note ?? (claimed.prNumber != null ? `Approved in genie, PR #${claimed.prNumber} merged` : 'Approved in genie (no PR to merge)');
  const moved = await transition(taskId, 'done', 'human', line);
  if (!moved.success) {
    await release();
    return moved;
  }
  // The preview is gone the moment the PR closes.
  await db.update(tasks).set({ claimedAt: null, previewUrl: null }).where(eq(tasks.id, taskId));

  let productionUrl: string | null = null;
  try {
    productionUrl = await deps.findProductionUrl(project);
  } catch (err) {
    await recordEvent(taskId, 'log', `Could not read the Pilots services list: ${describeError(err)}`);
  }
  if (productionUrl && productionUrl !== project.productionUrl) {
    await db.update(projects).set({ productionUrl }).where(eq(projects.id, project.id));
  }
  const production = productionUrl ?? project.productionUrl;
  await recordEvent(taskId, 'status', production
    ? `Pilots is deploying ${project.defaultBranch} to ${production}`
    : `No Pilots service tracks ${project.githubRepo}. Connect one to deploy ${project.defaultBranch}`);

  if (claimed.githubIssueNumber != null && claimed.prNumber != null) {
    const body = production
      ? `Merged #${claimed.prNumber} into \`${project.defaultBranch}\`. Pilots is deploying it to ${production}.`
      : `Merged #${claimed.prNumber} into \`${project.defaultBranch}\`.`;
    try {
      await deps.commentOnIssue(project, claimed.githubIssueNumber, `${commentMarker('merged')}\n${body}`);
    } catch (err) {
      await recordEvent(taskId, 'github', `Could not post the merge comment on issue #${claimed.githubIssueNumber}: ${describeError(err)}`);
    }
  }

  const row = (await db.query.tasks.findFirst({ where: { id: taskId } }))!;
  notifyBoard(row);
  return { success: true, data: row };
}

// `source` says where the feedback was typed. Feedback typed in genie is
// posted to the issue so GitHub sees why the card moved back; feedback that
// came FROM a GitHub comment or review is already there. Only the feedback
// the next revise must apply lives on the row; the feed keeps the history.
export async function requestChanges(taskId: string, feedback: string, source: VerdictSource): Promise<Outcome> {
  const text = feedback.trim();
  if (!text) return { success: false, fieldErrors: { feedback: 'Say what should change.' } };
  const task = await db.query.tasks.findFirst({ where: { id: taskId } });
  if (!task) return { success: false, error: 'Unknown task.', status: 404 };
  if (task.status !== 'ready_for_review') return { success: false, error: 'Only a task in Review can be sent back.', status: 409 };
  await db.update(tasks).set({ feedback: text }).where(eq(tasks.id, taskId));
  const result = await transition(taskId, 'in_progress', 'human', `Changes requested ${who(source)}: ${text}`);
  if (result.success && source === 'genie' && result.data.githubIssueNumber != null) {
    const project = await db.query.projects.findFirst({ where: { id: result.data.projectId } });
    if (project) {
      try {
        await deps.commentOnIssue(project, result.data.githubIssueNumber, `${commentMarker('feedback')}\nChanges requested in genie:\n\n${text}`);
      } catch (err) {
        await recordEvent(taskId, 'github', `Could not post the feedback comment: ${describeError(err)}`);
      }
    }
  }
  return result;
}
