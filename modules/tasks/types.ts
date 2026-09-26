// Browser-safe types for the tasks feature. No runtime import from a
// `.server.ts` file or from `db/` may live here (a type-only import is erased).
import type { Task, TaskEvent } from '#db/schema.server.ts';

export const TASK_STATUSES = ['todo', 'planning', 'in_progress', 'ready_for_review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const EVENT_KINDS = ['status', 'log', 'error', 'github'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type { Task, TaskEvent };

// The payload the worker broadcasts over /ws when a project's board changed.
export interface BoardChange {
  projectId: string;
  taskId: string;
  status: TaskStatus;
}
