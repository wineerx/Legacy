CREATE INDEX `jobs_ws_state` ON `jobs` (`workspace_id`,`state`);--> statement-breakpoint
CREATE INDEX `media_assets_ws_imported` ON `media_assets` (`workspace_id`,"imported_at" desc,`id`);