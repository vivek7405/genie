import { defineRelations } from 'drizzle-orm';
import { table, uuidPk, text, integer, json, createdAt, updatedAt, timestamp, uniqueIndex } from './columns.server.ts';
import type { EventKind, TaskStatus } from '#modules/tasks/types.ts';

// A project is a linked GitHub repository, optionally paired with the GitHub
// Project board that tracks it. genie's own tables stay the source of truth;
// the board is mirrored (M2).
// A person who signed in with GitHub. The access token is the user-to-server
// token the GitHub App's OAuth hands back; it lists the user's installations,
// repositories and project boards. Repository work uses installation tokens.
export const users = table('users', {
  id: uuidPk(),
  githubId: integer().notNull().unique(),
  login: text().notNull(),
  name: text(),
  avatarUrl: text(),
  accessToken: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projects = table('projects', {
  id: uuidPk(),
  // The person who connected it. Every read and write is scoped to them.
  userId: text().references(() => users.id),
  // The GitHub App installation that grants access to the repository.
  installationId: integer(),
  name: text().notNull(),
  // owner/name, as GitHub spells it. Unique per user, not globally.
  githubRepo: text().notNull(),
  githubProjectNumber: integer(),
  githubProjectId: text(),
  statusFieldId: text(),
  statusOptionIds: json<Partial<Record<TaskStatus, string>>>(),
  productionUrl: text(),
  defaultBranch: text().notNull().default('main'),
  // The last GitHub sync failure for this project (token scope, wrong board
  // number, rate limit), shown on the board page. Null once a tick succeeds.
  syncError: text(),
  syncedAt: timestamp(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('projects_user_repo_idx').on(t.userId, t.githubRepo)]);

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
  // A Claude rate limit is a wait, not a failure: the worker skips the task
  // until `deferredUntil`, the card shows `deferReason`, and `deferCount`
  // (consecutive deferrals of the current stage) drives the backoff.
  deferredUntil: timestamp(),
  deferReason: text(),
  deferCount: integer().notNull().default(0),
  syncedAt: timestamp(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('tasks_project_issue_idx').on(t.projectId, t.githubIssueNumber)]);

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

export const relations = defineRelations({ users, projects, tasks, taskEvents, settings }, (r) => ({
  users: {
    projects: r.many.projects(),
  },
  projects: {
    owner: r.one.users({ from: r.projects.userId, to: r.users.id }),
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
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type Setting = typeof settings.$inferSelect;
