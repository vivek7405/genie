// Server-only: the two human verdicts, shared by the genie UI actions and the
// GitHub sync so both entry points behave the same. M5 adds the PR merge to
// approve() and gets it on both paths.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import { describeError } from '#modules/github/client.server.ts';
import { commentMarker, commentOnIssue } from '#modules/github/issues.server.ts';
import { recordEvent } from './events.server.ts';
import { transition } from './transitions.server.ts';

export type VerdictSource = 'genie' | 'github';

export async function approve(taskId: string, note = 'Approved by reviewer') {
  return transition(taskId, 'done', 'human', note);
}

// `source` says where the feedback was typed. Feedback typed in genie is
// posted to the issue so GitHub sees why the card moved back; feedback that
// came FROM a GitHub comment or review is already there.
export async function requestChanges(taskId: string, feedback: string, source: VerdictSource) {
  await db.update(tasks).set({ feedback }).where(eq(tasks.id, taskId));
  const result = await transition(taskId, 'in_progress', 'human', `Changes requested: ${feedback}`);
  if (result.success && source === 'genie' && result.data.githubIssueNumber != null) {
    const project = await db.query.projects.findFirst({ where: { id: result.data.projectId } });
    if (project) {
      try {
        await commentOnIssue(project, result.data.githubIssueNumber, `${commentMarker('feedback')}\nChanges requested in genie:\n\n${feedback}`);
      } catch (err) {
        await recordEvent(taskId, 'github', `Could not post the feedback comment: ${describeError(err)}`);
      }
    }
  }
  return result;
}
