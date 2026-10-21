CREATE TABLE destination_accounts (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, provider_id TEXT NOT NULL, username TEXT NOT NULL,
 revision TEXT NOT NULL, validated_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'connected', expires_at TEXT, permissions_json TEXT NOT NULL DEFAULT '[]',
 PRIMARY KEY(workspace_id, provider, provider_id)
);
--> statement-breakpoint
CREATE TABLE provider_limits (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, account_id TEXT NOT NULL, operation TEXT NOT NULL,
 cooldown_until TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id, provider, account_id, operation)
);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN lease_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX jobs_stalled ON jobs(state, lease_until);
--> statement-breakpoint
CREATE INDEX job_attempts_job_started ON job_attempts(job_id, started_at);
--> statement-breakpoint
CREATE INDEX jobs_destination ON jobs(workspace_id, type, state, json_extract(payload_json, '$.accountId'));
--> statement-breakpoint
CREATE INDEX jobs_batch ON jobs(workspace_id, json_extract(payload_json, '$.batchId'));
