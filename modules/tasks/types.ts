// Browser-safe task types. Type-only imports from the schema are erased.
import type { Task, TaskEvent } from '#db/schema.server.ts';

export const TASK_STATUSES = ['backlog', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const EVENT_KINDS = ['status', 'log', 'error', 'github'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// `none` means the repository ran no checks. `pending` means they outlasted the wait.
export const CI_STATUSES = ['none', 'pending', 'passing', 'failing'] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

export type { Task, TaskEvent };

// What the worker broadcasts over /ws when a card changed.
export interface BoardChange {
  projectId: string;
  taskId: string;
  status: TaskStatus;
}
