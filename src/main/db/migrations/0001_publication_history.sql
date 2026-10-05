CREATE TABLE publication_history (
  job_id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  username text NOT NULL,
  post_id text NOT NULL,
  asset_sha text,
  media_id text,
  provenance_json text NOT NULL,
  published_at text NOT NULL,
  cleanup_state text NOT NULL DEFAULT 'kept'
);
--> statement-breakpoint
CREATE INDEX publication_history_ws_account ON publication_history(workspace_id, account_id);
--> statement-breakpoint
INSERT OR IGNORE INTO publication_history (job_id, workspace_id, account_id, username, post_id, asset_sha, media_id, provenance_json, published_at, cleanup_state)
SELECT j.id, j.workspace_id, json_extract(j.payload_json, '$.accountId'), substr(j.label, instr(j.label, '@') + 1),
json_extract(j.payload_json, '$.postId'), a.sha256, json_extract(j.result_json, '$.mediaId'),
json_object('profile', p.username, 'permalink', r.permalink, 'caption', r.caption, 'views', r.views, 'likes', r.likes, 'comments', r.comments, 'assetId', a.id, 'downloadedAt', a.imported_at), j.updated_at, 'kept'
FROM jobs j
LEFT JOIN remote_posts r ON r.id = json_extract(j.payload_json, '$.postId') AND r.workspace_id = j.workspace_id
LEFT JOIN tracked_profiles p ON p.id = r.profile_id AND p.workspace_id = j.workspace_id
LEFT JOIN media_assets a ON a.id = r.asset_id AND a.workspace_id = j.workspace_id
WHERE j.type = 'publish_instagram' AND j.state = 'done' AND json_valid(j.payload_json) AND json_valid(j.result_json)
AND json_extract(j.payload_json, '$.accountId') IS NOT NULL AND json_extract(j.payload_json, '$.postId') IS NOT NULL
AND (json_extract(j.result_json, '$.mediaId') IS NOT NULL OR json_extract(j.result_json, '$.confirmedPublished') = 1);
