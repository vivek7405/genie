// Decides whether a broadcast concerns what a page is showing. Pure, so a unit
// test covers it without a socket.
import type { BoardChange } from '../types.ts';

export function isChangeFor(message: unknown, projectId: string, taskId = ''): message is BoardChange {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Partial<BoardChange>;
  if (m.projectId !== projectId) return false;
  return !taskId || m.taskId === taskId;
}
