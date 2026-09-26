// Server-only: the activity feed and the live-board push. broadcast() fans a
// message to every socket connected to /ws (single instance, which is what
// genie is).
import { broadcast } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { taskEvents } from '#db/schema.server.ts';
import type { BoardChange, EventKind, Task } from '#modules/tasks/types.ts';
import { redact } from './pilots.server.ts';

// Every line goes through redact(): git prints a rewritten remote URL on
// error and gh can echo a token in a 401, so no caller can leak a secret into
// the feed even by mistake.
export async function recordEvent(taskId: string, kind: EventKind, message: string): Promise<void> {
  await db.insert(taskEvents).values({ taskId, kind, message: redact(message) });
}

export function notifyBoard(task: Pick<Task, 'id' | 'projectId' | 'status'>): void {
  const change: BoardChange = { projectId: task.projectId, taskId: task.id, status: task.status };
  broadcast('/ws', JSON.stringify(change));
}
