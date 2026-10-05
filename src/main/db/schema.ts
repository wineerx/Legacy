import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull(),
  createdAt: text('created_at').notNull()
})

export const settings = sqliteTable('settings', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull()
}, (t) => [primaryKey({ columns: [t.workspaceId, t.key] })])

export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  origin: text('origin', { enum: ['pc', 'ig_own', 'ig_third_party', 'link_ref'] }).notNull(),
  sourceName: text('source_name').notNull(),
  filePath: text('file_path').notNull(),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  durationMs: integer('duration_ms').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  videoCodec: text('video_codec').notNull(),
  audioCodec: text('audio_codec'),
  thumbnailPath: text('thumbnail_path'),
  validationJson: text('validation_json').notNull(),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  rightsNote: text('rights_note'),
  importedAt: text('imported_at').notNull()
}, (t) => [uniqueIndex('media_assets_ws_sha').on(t.workspaceId, t.sha256)])

export const mediaVersions = sqliteTable('media_versions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull().references(() => mediaAssets.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['cover_png', 'banner', 'stripped'] }).notNull(),
  paramsJson: text('params_json').notNull(),
  filePath: text('file_path').notNull(),
  createdAt: text('created_at').notNull()
}, (t) => [index('media_versions_asset').on(t.assetId)])

export const coverTemplates = sqliteTable('cover_templates', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['image', 'frame_text'] }).notNull(),
  imagePath: text('image_path'),
  frameMs: integer('frame_ms'),
  textJson: text('text_json'),
  createdAt: text('created_at').notNull()
})

export const trackedProfiles = sqliteTable('tracked_profiles', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  platform: text('platform', { enum: ['instagram'] }).notNull(),
  username: text('username').notNull(),
  url: text('url').notNull(),
  connectedAccountId: text('connected_account_id'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull()
}, (t) => [uniqueIndex('tracked_profiles_ws_user').on(t.workspaceId, t.platform, t.username)])

export const remotePosts = sqliteTable('remote_posts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => trackedProfiles.id, { onDelete: 'cascade' }),
  remoteId: text('remote_id'),
  permalink: text('permalink').notNull(),
  mediaProductType: text('media_product_type'),
  caption: text('caption'),
  postedAt: text('posted_at'),
  durationMs: integer('duration_ms'),
  thumbnailPath: text('thumbnail_path'),
  assetId: text('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  views: integer('views'),
  likes: integer('likes'),
  comments: integer('comments'),
  metricsSource: text('metrics_source', { enum: ['api', 'csv'] }),
  metricsUpdatedAt: text('metrics_updated_at'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false)
}, (t) => [uniqueIndex('remote_posts_ws_permalink').on(t.workspaceId, t.permalink), index('remote_posts_profile').on(t.profileId), index('remote_posts_ws_asset').on(t.workspaceId, t.assetId, t.metricsUpdatedAt)])

export const metricSnapshots = sqliteTable('metric_snapshots', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  remotePostId: text('remote_post_id').notNull().references(() => remotePosts.id, { onDelete: 'cascade' }),
  metric: text('metric').notNull(),
  value: integer('value'),
  source: text('source', { enum: ['api', 'csv'] }).notNull(),
  capturedAt: text('captured_at').notNull()
})

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull(),
  label: text('label').notNull(),
  state: text('state', { enum: ['queued', 'running', 'done', 'failed', 'cancelled'] }).notNull(),
  runAt: text('run_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  leaseUntil: text('lease_until'),
  idempotencyKey: text('idempotency_key'),
  lastError: text('last_error'),
  resultJson: text('result_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (t) => [uniqueIndex('jobs_idem').on(t.idempotencyKey), index('jobs_pick').on(t.state, t.runAt), index('jobs_ws_type_state').on(t.workspaceId, t.type, t.state)])

export const jobAttempts = sqliteTable('job_attempts', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  outcome: text('outcome', { enum: ['ok', 'retry', 'failed', 'lease_expired'] }),
  errorCode: text('error_code'),
  errorMessage: text('error_message')
})

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['info', 'error', 'manual_task'] }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  actionJson: text('action_json'),
  dueAt: text('due_at'),
  shownAt: text('shown_at'),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull()
})

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  action: text('action').notNull(),
  detailJson: text('detail_json').notNull(),
  createdAt: text('created_at').notNull()
})

// Independent of source rows: provenance survives deletion of the local copy/profile.
export const publicationHistory = sqliteTable('publication_history', {
  jobId: text('job_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(), username: text('username').notNull(),
  postId: text('post_id').notNull(), assetSha: text('asset_sha'), mediaId: text('media_id'),
  provenanceJson: text('provenance_json').notNull(), publishedAt: text('published_at').notNull(),
  cleanupState: text('cleanup_state').notNull().default('kept')
}, t => [index('publication_history_ws_account').on(t.workspaceId, t.accountId), index('publication_history_ws_sha').on(t.workspaceId, t.assetSha, t.publishedAt)])
