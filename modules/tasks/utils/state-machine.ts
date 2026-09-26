// The task state machine, shared by the worker (server) and the board UI. Pure
// data and functions: no DB, no framework import.
import type { Task, TaskStatus } from '../types.ts';

export type Actor = 'system' | 'human';

export interface Column {
  status: TaskStatus;
  label: string;
  hint: string;
}

export const COLUMNS: readonly Column[] = [
  { status: 'todo', label: 'Todo', hint: 'Waiting for genie to pick it up' },
  { status: 'planning', label: 'Plan', hint: 'genie is writing the plan' },
  { status: 'in_progress', label: 'In progress', hint: 'genie is building and self-reviewing on a branch' },
  { status: 'ready_for_review', label: 'Review', hint: 'Implemented and self-reviewed; a PR and a preview wait for you' },
  { status: 'done', label: 'Done', hint: 'Merged, Pilots deploys the default branch' },
];

// The stage the worker advances a task to once the current stage completes.
export const SYSTEM_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus>> = {
  todo: 'planning',
  planning: 'in_progress',
  in_progress: 'ready_for_review',
};

// The verdicts a reviewer may give from ready_for_review.
export const HUMAN_TRANSITIONS: Partial<Record<TaskStatus, readonly TaskStatus[]>> = {
  ready_for_review: ['done', 'in_progress'],
};

export function canTransition(from: TaskStatus, to: TaskStatus, actor: Actor): boolean {
  if (actor === 'system') return SYSTEM_TRANSITIONS[from] === to;
  return HUMAN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextSystemStatus(status: TaskStatus): TaskStatus | null {
  return SYSTEM_TRANSITIONS[status] ?? null;
}

// A task the worker should be driving: it sits in a system-owned stage (or
// todo, waiting to be claimed) and has not failed.
export function isSystemOwned(task: Pick<Task, 'status' | 'error'>): boolean {
  return task.error == null && SYSTEM_TRANSITIONS[task.status] !== undefined;
}

export function labelOf(status: TaskStatus): string {
  return COLUMNS.find((c) => c.status === status)?.label ?? status;
}

export function groupByColumn<T extends Pick<Task, 'status'>>(tasks: readonly T[]): (Column & { tasks: T[] })[] {
  return COLUMNS.map((column) => ({ ...column, tasks: tasks.filter((t) => t.status === column.status) }));
}
