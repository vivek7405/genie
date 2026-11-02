// The task state machine, shared by the worker and the board. Pure data.
import type { Task, TaskStatus } from '../types.ts';

export type Actor = 'system' | 'human';

export interface Column {
  status: TaskStatus;
  label: string;
  hint: string;
}

export const COLUMNS: readonly Column[] = [
  { status: 'backlog', label: 'Backlog', hint: 'Add a task above and Genie picks it up.' },
  { status: 'in_progress', label: 'In progress', hint: 'Genie works here, one task per repo.' },
  { status: 'review', label: 'Review', hint: 'Pull requests waiting for your verdict.' },
  { status: 'done', label: 'Done', hint: 'Merged work lands here.' },
];

// The next stage once the worker finishes the current one.
export const SYSTEM_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus>> = {
  backlog: 'in_progress',
  in_progress: 'review',
};

// The verdicts a reviewer may give.
export const HUMAN_TRANSITIONS: Partial<Record<TaskStatus, readonly TaskStatus[]>> = {
  review: ['done', 'in_progress'],
};

export function canTransition(from: TaskStatus, to: TaskStatus, actor: Actor): boolean {
  if (actor === 'system') return SYSTEM_TRANSITIONS[from] === to;
  return HUMAN_TRANSITIONS[from]?.includes(to) ?? false;
}

// Genie is actively on it: a claimed run, as opposed to a card still queued.
export function isWorking(task: Pick<Task, 'status' | 'error' | 'claimedAt'>): boolean {
  return task.error == null && task.claimedAt != null && SYSTEM_TRANSITIONS[task.status] !== undefined;
}

export const STOPPED = 'Stopped. Retry to start again, or delete this task.';

// Queued or running, and not already failed or stopped.
export function canStop(task: Pick<Task, 'status' | 'error'>): boolean {
  return task.error == null && SYSTEM_TRANSITIONS[task.status] !== undefined;
}

// Only a card nobody is working on, and never one with a live pull request.
export function canDelete(task: Pick<Task, 'status' | 'error' | 'claimedAt' | 'prNumber'>): boolean {
  if (task.claimedAt) return false;
  return task.status === 'backlog' || (task.error != null && task.prNumber == null);
}

export function labelOf(status: TaskStatus): string {
  return COLUMNS.find((c) => c.status === status)?.label ?? status;
}

export function groupByColumn<T extends Pick<Task, 'status'>>(tasks: readonly T[]): (Column & { tasks: T[] })[] {
  return COLUMNS.map((column) => ({ ...column, tasks: tasks.filter((t) => t.status === column.status) }));
}
