// The work each system-owned stage does. M1 ships a stub that waits and
// advances, so the board can be watched end to end before pilots and Claude
// Code are wired in (M3, M4). The worker only knows this one function.
import { recordEvent } from './events.server.ts';
import type { Task, TaskStatus } from '#modules/tasks/types.ts';
import { nextSystemStatus } from '#modules/tasks/utils/state-machine.ts';

const STEP_MS = Number(process.env.GENIE_STUB_STEP_MS ?? 4000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Returns the status the task should move to once this stage is complete, or
// null when the task's current status has no system-owned successor.
export async function runStage(task: Task): Promise<TaskStatus | null> {
  const next = nextSystemStatus(task.status);
  if (!next) return null;
  await recordEvent(task.id, 'log', `Stub stage: ${task.status} (attempt ${task.attempt})`);
  await sleep(STEP_MS);
  return next;
}
