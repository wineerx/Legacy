ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE jobs SET priority = min(2, max(0, coalesce((SELECT cast(value AS integer) FROM settings WHERE workspace_id = jobs.workspace_id AND key = 'jobPriority.' || jobs.id), 0)));
--> statement-breakpoint
CREATE INDEX jobs_claim ON jobs(state, priority DESC, run_at, created_at);
--> statement-breakpoint
CREATE INDEX jobs_type_state ON jobs(type, state);
--> statement-breakpoint
CREATE INDEX job_attempts_started ON job_attempts(started_at);
