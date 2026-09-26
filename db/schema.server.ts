import { defineRelations } from 'drizzle-orm';
import { table, uuidPk, text, integer, json, createdAt, updatedAt, timestamp } from './columns.server.ts';
import type { EventKind, TaskStatus } from '#modules/tasks/types.ts';

// A project is a linked GitHub repository, optionally paired with the GitHub
// Project board that tracks it. genie's own tables stay the source of truth;
// the board is mirrored (M2).
export const projects = table('projects', {
  id: uuidPk(),
  name: text().notNull(),
  // owner/name, as GitHub spells it.
  githubRepo: text().notNull().unique(),
  githubProjectNumber: integer(),
  githubProjectId: text(),
  statusFieldId: text(),
  statusOptionIds: json<Partial<Record<TaskStatus, string>>>(),
  productionUrl: text(),
  defaultBranch: text().notNull().default('main'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One task is one card on the board and (once synced) one GitHub issue. The
// pipeline owns the middle statuses; a human owns todo and the review verdict.
// A failed stage keeps its status and sets `error`, so the card stays in the
// column it failed in and Retry simply clears the error.
export const tasks = table('tasks', {
  id: uuidPk(),
  projectId: text().notNull().references(() => projects.id),
  githubIssueNumber: integer(),
  githubItemId: text(),
  title: text().notNull(),
  description: text().notNull().default(''),
  status: text().$type<TaskStatus>().notNull().default('todo'),
  plan: text(),
  branch: text(),
  prNumber: integer(),
  prUrl: text(),
  previewUrl: text(),
  machineId: text(),
  machineName: text(),
  feedback: text(),
  error: text(),
  attempt: integer().notNull().default(0),
  claimedAt: timestamp(),
  syncedAt: timestamp(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// The per-card activity feed: status changes, agent log lines, errors, and
// GitHub mirror events.
export const taskEvents = table('task_events', {
  id: uuidPk(),
  taskId: text().notNull().references(() => tasks.id),
  kind: text().$type<EventKind>().notNull(),
  message: text().notNull(),
  createdAt: createdAt(),
});

// Small key/value store for install-wide state (the pilots base checkpoint id,
// the GitHub login the token belongs to).
export const settings = table('settings', {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: updatedAt(),
});

export const relations = defineRelations({ projects, tasks, taskEvents, settings }, (r) => ({
  projects: {
    tasks: r.many.tasks(),
  },
  tasks: {
    project: r.one.projects({ from: r.tasks.projectId, to: r.projects.id }),
    events: r.many.taskEvents(),
  },
  taskEvents: {
    task: r.one.tasks({ from: r.taskEvents.taskId, to: r.tasks.id }),
  },
}));

// Derived types, never hand-written.
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type Setting = typeof settings.$inferSelect;
