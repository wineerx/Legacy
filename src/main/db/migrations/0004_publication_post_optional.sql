PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publication_history` (
	`job_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`username` text NOT NULL,
	`post_id` text,
	`asset_sha` text,
	`media_id` text,
	`provenance_json` text NOT NULL,
	`published_at` text NOT NULL,
	`cleanup_state` text DEFAULT 'kept' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_publication_history`("job_id", "workspace_id", "account_id", "username", "post_id", "asset_sha", "media_id", "provenance_json", "published_at", "cleanup_state") SELECT "job_id", "workspace_id", "account_id", "username", "post_id", "asset_sha", "media_id", "provenance_json", "published_at", "cleanup_state" FROM `publication_history`;--> statement-breakpoint
DROP TABLE `publication_history`;--> statement-breakpoint
ALTER TABLE `__new_publication_history` RENAME TO `publication_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `publication_history_ws_account` ON `publication_history` (`workspace_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `publication_history_ws_sha` ON `publication_history` (`workspace_id`,`asset_sha`,`published_at`);