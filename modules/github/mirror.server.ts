// Server-only: the genie-to-GitHub direction. mirrorTask() runs after every
// transition and never throws: a failure is a `github` event, and the sync
// tick re-asserts the card later. publishTask() turns a genie-created task
// into an issue plus a Todo card, and is retried by the sync until it links.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Project } from '#modules/projects/types.ts';
import type { Task } from '#modules/tasks/types.ts';
import { labelOf } from '#modules/tasks/utils/state-machine.ts';
import { recordEvent } from '#modules/pipeline/events.server.ts';
import { describeError } from './client.server.ts';
import { commentMarker, commentOnIssue, createIssue, readIssue, taskMarker, type Issue } from './issues.server.ts';
import { addIssueToBoard, itemIdForIssue, moveItem } from './projects-v2.server.ts';

// The comment a status change earns, or null for a silent move.
function statusComment(task: Task): string | null {
  if (task.status === 'ready_for_review') {
    return [
      commentMarker('ready_for_review'),
      'Ready for review.',
      '',
      `- Pull request: ${task.prUrl ?? 'pending'}`,
      `- Preview: ${task.previewUrl ?? 'pending'}`,
      '',
      'Move this card to **Done** to approve, or back to **In progress** with a comment describing what should change.',
      'On the pull request, an approving review or a merge also approves, and a review requesting changes or a comment starting with `GENIE:` sends it back with that text as the feedback.',
    ].join('\n');
  }
  if (task.status === 'done') return `${commentMarker('done')}\nApproved.`;
  return null;
}

// Resolves (and stores) the board item for a linked task, adding the issue to
// the board when it is not there yet.
async function ensureItem(project: Project, task: Task, issueNumber: number): Promise<string | null> {
  if (!project.githubProjectId) return null;
  let itemId = task.githubItemId ?? (await itemIdForIssue(project, issueNumber));
  if (!itemId) itemId = await addIssueToBoard(project, (await readIssue(project, issueNumber)).nodeId);
  if (itemId !== task.githubItemId) await db.update(tasks).set({ githubItemId: itemId }).where(eq(tasks.id, task.id));
  return itemId;
}

export async function mirrorTask(task: Task): Promise<void> {
  if (task.githubIssueNumber == null) return;
  const project = await db.query.projects.findFirst({ where: { id: task.projectId } });
  if (!project) return;
  try {
    const itemId = await ensureItem(project, task, task.githubIssueNumber);
    if (itemId) await moveItem(project, itemId, task.status);
    const comment = statusComment(task);
    if (comment) await commentOnIssue(project, task.githubIssueNumber, comment);
    await db.update(tasks).set({ syncedAt: new Date() }).where(eq(tasks.id, task.id));
    await recordEvent(task.id, 'github', `Mirrored ${labelOf(task.status)} to GitHub`);
  } catch (err) {
    await recordEvent(task.id, 'github', `GitHub mirror failed: ${describeError(err)}`);
  }
}

// Creates the issue (label + marker), puts it on the board in Todo and links
// the row. `existing` is an issue the sync found by marker, in which case the
// create is skipped. Throws so the caller decides how to report.
export async function publishTask(project: Project, task: Task, existing?: Issue): Promise<Task> {
  const issue = existing ?? (await createIssue(project, { title: task.title, body: `${task.description}\n\n${taskMarker(task.id)}`.trim() }));
  let itemId: string | null = null;
  if (project.githubProjectId) {
    itemId = (await itemIdForIssue(project, issue.number)) ?? (await addIssueToBoard(project, issue.nodeId));
    await moveItem(project, itemId, 'todo');
  }
  const [row] = await db.update(tasks).set({ githubIssueNumber: issue.number, githubItemId: itemId, syncedAt: new Date() }).where(eq(tasks.id, task.id)).returning();
  await recordEvent(task.id, 'github', `${existing ? 'Linked to' : 'Opened'} issue #${issue.number} ${issue.htmlUrl}`);
  return row;
}
