CREATE TABLE `provider_quota_snapshots` (
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`quota_usage` integer,
	`quota_total` integer,
	`quota_duration_sec` integer,
	`fetched_at` text,
	`attempted_at` text NOT NULL,
	`last_status` text NOT NULL,
	`error_kind` text,
	`error_message` text,
	PRIMARY KEY(`workspace_id`, `provider`, `account_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
