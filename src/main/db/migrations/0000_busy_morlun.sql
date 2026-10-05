CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`action` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cover_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`image_path` text,
	`frame_ms` integer,
	`text_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`outcome` text,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`label` text NOT NULL,
	`state` text NOT NULL,
	`run_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`lease_until` text,
	`idempotency_key` text,
	`last_error` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idem` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_pick` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`origin` text NOT NULL,
	`source_name` text NOT NULL,
	`file_path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`video_codec` text NOT NULL,
	`thumbnail_path` text,
	`validation_json` text NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`rights_note` text,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_ws_sha` ON `media_assets` (`workspace_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `media_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`params_json` text NOT NULL,
	`file_path` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_versions_asset` ON `media_versions` (`asset_id`);--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`remote_post_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer,
	`source` text NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`remote_post_id`) REFERENCES `remote_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`action_json` text,
	`due_at` text,
	`shown_at` text,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `remote_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`remote_id` text,
	`permalink` text NOT NULL,
	`media_product_type` text,
	`caption` text,
	`posted_at` text,
	`duration_ms` integer,
	`thumbnail_path` text,
	`asset_id` text,
	`views` integer,
	`likes` integer,
	`comments` integer,
	`metrics_source` text,
	`metrics_updated_at` text,
	`favorite` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `tracked_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_posts_ws_permalink` ON `remote_posts` (`workspace_id`,`permalink`);--> statement-breakpoint
CREATE INDEX `remote_posts_profile` ON `remote_posts` (`profile_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracked_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`username` text NOT NULL,
	`url` text NOT NULL,
	`connected_account_id` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_profiles_ws_user` ON `tracked_profiles` (`workspace_id`,`platform`,`username`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` text NOT NULL
);
