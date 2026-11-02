CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`github_repo` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	CONSTRAINT `fk_task_events_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`branch` text,
	`pr_number` integer,
	`pr_url` text,
	`machine_id` text,
	`machine_name` text,
	`feedback` text,
	`error` text,
	`claimed_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	CONSTRAINT `fk_tasks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`github_id` integer NOT NULL UNIQUE,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_repo_idx` ON `projects` (`github_repo`);