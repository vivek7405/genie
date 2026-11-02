import { defineRelations } from 'drizzle-orm';
import { uniqueIndex } from 'drizzle-orm/sqlite-core';
import { table, uuidPk, text, integer, createdAt, updatedAt, timestamp } from './columns.server.ts';
import type { EventKind, TaskStatus } from '#modules/tasks/types.ts';

// The one person who may use this Genie: the owner of GH_TOKEN.
export const users = table('users', {
  id: uuidPk(),
  githubId: integer().notNull().unique(),
  login: text().notNull(),
  name: text(),
  avatarUrl: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// A connected GitHub repository.
export const projects = table('projects', {
  id: uuidPk(),
  // owner/name, as GitHub spells it.
  githubRepo: text().notNull(),
  defaultBranch: text().notNull().default('main'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('projects_repo_idx').on(t.githubRepo)]);

// One card on the board. A failed stage keeps its status and sets `error`, so
// the card stays where it failed and Retry only has to clear the error.
export const tasks = table('tasks', {
  id: uuidPk(),
  projectId: text().notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text().notNull(),
  description: text().notNull().default(''),
  status: text().$type<TaskStatus>().notNull().default('backlog'),
  branch: text(),
  prNumber: integer(),
  prUrl: text(),
  machineId: text(),
  machineName: text(),
  // A pending reviewer instruction: while set, the build stage revises.
  feedback: text(),
  error: text(),
  claimedAt: timestamp(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// The per-card activity feed.
export const taskEvents = table('task_events', {
  id: uuidPk(),
  taskId: text().notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  kind: text().$type<EventKind>().notNull(),
  message: text().notNull(),
  createdAt: createdAt(),
});

export const relations = defineRelations({ users, projects, tasks, taskEvents }, (r) => ({
  projects: { tasks: r.many.tasks() },
  tasks: {
    project: r.one.projects({ from: r.tasks.projectId, to: r.projects.id }),
    events: r.many.taskEvents(),
  },
  taskEvents: { task: r.one.tasks({ from: r.taskEvents.taskId, to: r.tasks.id }) },
}));

// Derived types, never hand-written.
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
