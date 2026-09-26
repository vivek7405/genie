// Pure helper for the live-refresh component: decide whether a broadcast
// message concerns the project a board is showing. Kept out of the component
// so a Node unit test covers it without a WebSocket.
import type { BoardChange } from '../types.ts';

export function isBoardChangeFor(message: unknown, projectId: string): message is BoardChange {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Partial<BoardChange>;
  return typeof m.projectId === 'string' && m.projectId === projectId;
}
