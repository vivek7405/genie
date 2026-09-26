ALTER TABLE `tasks` ADD `deferred_until` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `defer_reason` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `defer_count` integer DEFAULT 0 NOT NULL;