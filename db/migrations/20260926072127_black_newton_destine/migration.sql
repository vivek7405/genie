ALTER TABLE `projects` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `synced_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_issue_idx` ON `tasks` (`project_id`,`github_issue_number`);