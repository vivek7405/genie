// Server-only: the activity feed and the live-board push. broadcast() fans a
// message to every socket connected to /ws (single instance, which is what
// genie is).
import { broadcast } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { taskEvents } from '#db/schema.server.ts';
import type { BoardChange, EventKind, Task } from '#modules/tasks/types.ts';

export async function recordEvent(taskId: string, kind: EventKind, message: string): Promise<void> {
  await db.insert(taskEvents).values({ taskId, kind, message });
}

export function notifyBoard(task: Pick<Task, 'id' | 'projectId' | 'status'>): void {
  const change: BoardChange = { projectId: task.projectId, taskId: task.id, status: task.status };
  broadcast('/ws', JSON.stringify(change));
}
