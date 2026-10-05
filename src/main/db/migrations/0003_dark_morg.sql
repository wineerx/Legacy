CREATE INDEX `jobs_ws_type_state` ON `jobs` (`workspace_id`,`type`,`state`);--> statement-breakpoint
CREATE INDEX `publication_history_ws_sha` ON `publication_history` (`workspace_id`,`asset_sha`,`published_at`);--> statement-breakpoint
CREATE INDEX `remote_posts_ws_asset` ON `remote_posts` (`workspace_id`,`asset_id`,`metrics_updated_at`);