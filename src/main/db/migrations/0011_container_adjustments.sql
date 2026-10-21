CREATE TABLE `publication_container_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`container_id` text NOT NULL,
	`kind` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`container_id`) REFERENCES `publication_containers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `publication_container_adjustments_ws_container` ON `publication_container_adjustments` (`workspace_id`,`container_id`,`created_at`);