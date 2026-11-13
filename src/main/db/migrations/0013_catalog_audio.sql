ALTER TABLE `destination_accounts` ADD `auth_kind` text DEFAULT 'instagram_login' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication_container_items` ADD `audio_id` text;--> statement-breakpoint
ALTER TABLE `publication_container_items` ADD `audio_volume` integer;--> statement-breakpoint
ALTER TABLE `publication_container_items` ADD `video_volume` integer;