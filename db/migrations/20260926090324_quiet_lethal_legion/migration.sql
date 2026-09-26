CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`github_id` integer NOT NULL UNIQUE,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`access_token` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `installation_id` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`installation_id` integer,
	`name` text NOT NULL,
	`github_repo` text NOT NULL,
	`github_project_number` integer,
	`github_project_id` text,
	`status_field_id` text,
	`status_option_ids` text,
	`production_url` text,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`sync_error` text,
	`synced_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	CONSTRAINT `fk_projects_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_projects`(`id`, `name`, `github_repo`, `github_project_number`, `github_project_id`, `status_field_id`, `status_option_ids`, `production_url`, `default_branch`, `sync_error`, `synced_at`, `created_at`, `updated_at`) SELECT `id`, `name`, `github_repo`, `github_project_number`, `github_project_id`, `status_field_id`, `status_option_ids`, `production_url`, `default_branch`, `sync_error`, `synced_at`, `created_at`, `updated_at` FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_user_repo_idx` ON `projects` (`user_id`,`github_repo`);