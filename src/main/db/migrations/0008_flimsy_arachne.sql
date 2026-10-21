CREATE TABLE `publication_container_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`container_id` text NOT NULL,
	`position` integer NOT NULL,
	`asset_id` text,
	`source_snapshot_json` text NOT NULL,
	`caption_override` text,
	`planned_publish_at` text,
	`recipe_version_id` text,
	`share_to_feed` integer DEFAULT true NOT NULL,
	`allow_repost` integer DEFAULT false NOT NULL,
	`effective_snapshot_json` text,
	`job_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`container_id`) REFERENCES `publication_containers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`asset_id`) REFERENCES `media_assets`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`job_id`) REFERENCES `jobs`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publication_container_items_position" CHECK("publication_container_items"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_container_items_order` ON `publication_container_items` (`workspace_id`,`container_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_container_items_job` ON `publication_container_items` (`job_id`);--> statement-breakpoint
CREATE INDEX `publication_container_items_asset` ON `publication_container_items` (`workspace_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `publication_containers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`technical_batch_id` text,
	`name` text NOT NULL,
	`provider` text,
	`destination_account_id` text,
	`account_revision` text,
	`time_zone` text NOT NULL,
	`planned_start_at` text,
	`planned_end_at` text,
	`interval_min` integer DEFAULT 15 NOT NULL,
	`caption_base` text DEFAULT '' NOT NULL,
	`visual_snapshot_json` text DEFAULT '{"version":1}' NOT NULL,
	`scheduled_at` text,
	`scheduled_revision` integer,
	`control_state` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`provider`,`destination_account_id`) REFERENCES `destination_accounts`(`workspace_id`,`provider`,`provider_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publication_containers_control" CHECK("publication_containers"."control_state" in ('active','paused','cancelled')),
	CONSTRAINT "publication_containers_interval" CHECK("publication_containers"."interval_min" between 15 and 10080),
	CONSTRAINT "publication_containers_provider" CHECK("publication_containers"."provider" is null or "publication_containers"."provider" = 'instagram'),
	CONSTRAINT "publication_containers_destination" CHECK(("publication_containers"."provider" is null) = ("publication_containers"."destination_account_id" is null)),
	CONSTRAINT "publication_containers_plan" CHECK("publication_containers"."scheduled_at" is null or ("publication_containers"."destination_account_id" is not null and "publication_containers"."account_revision" is not null and "publication_containers"."planned_start_at" is not null and "publication_containers"."planned_end_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_containers_ws_id` ON `publication_containers` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_containers_request` ON `publication_containers` (`workspace_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `publication_containers_created` ON `publication_containers` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `publication_containers_planned` ON `publication_containers` (`workspace_id`,`planned_start_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_ws_id` ON `jobs` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_ws_id` ON `media_assets` (`workspace_id`,`id`);