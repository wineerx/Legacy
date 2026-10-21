import { sqliteTable, text, integer, uniqueIndex, index, primaryKey, foreignKey, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

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
  origin: text('origin', { enum: ['pc', 'ig_own', 'ig_third_party', 'tiktok_third_party', 'link_ref'] }).notNull(),
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
}, (t) => [uniqueIndex('media_assets_ws_id').on(t.workspaceId, t.id), uniqueIndex('media_assets_ws_sha').on(t.workspaceId, t.sha256), index('media_assets_ws_imported').on(t.workspaceId, sql`${t.importedAt} desc`, t.id)])

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

export const visualTemplates = sqliteTable('visual_templates', {
  id:text('id').primaryKey(), workspaceId:text('workspace_id').notNull().references(()=>workspaces.id,{onDelete:'cascade'}),
  status:text('status',{enum:['active','archived']}).notNull().default('active'), currentVersion:integer('current_version').notNull().default(1), revision:integer('revision').notNull().default(1),
  createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('visual_templates_ws_id').on(t.workspaceId,t.id),index('visual_templates_ws_status').on(t.workspaceId,t.status)])
export const visualTemplateVersions = sqliteTable('visual_template_versions', {
  workspaceId:text('workspace_id').notNull(), templateId:text('template_id').notNull(), version:integer('version').notNull(),
  name:text('name').notNull(), description:text('description').notNull(), visualJson:text('visual_json').notNull(), createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.workspaceId,t.templateId,t.version]}),foreignKey({columns:[t.workspaceId,t.templateId],foreignColumns:[visualTemplates.workspaceId,visualTemplates.id]}).onDelete('cascade')])
export const visualTemplateRequests = sqliteTable('visual_template_requests', {
  workspaceId:text('workspace_id').notNull().references(()=>workspaces.id,{onDelete:'cascade'}), requestId:text('request_id').notNull(), fingerprint:text('fingerprint').notNull(), resultJson:text('result_json').notNull()
},t=>[primaryKey({columns:[t.workspaceId,t.requestId]})])

export const trackedProfiles = sqliteTable('tracked_profiles', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  platform: text('platform', { enum: ['instagram', 'tiktok'] }).notNull(),
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
  leaseVersion: integer('lease_version').notNull().default(0),
  priority: integer('priority').notNull().default(0),
  idempotencyKey: text('idempotency_key'),
  lastError: text('last_error'),
  resultJson: text('result_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (t) => [uniqueIndex('jobs_ws_id').on(t.workspaceId, t.id), uniqueIndex('jobs_idem').on(t.idempotencyKey), index('jobs_pick').on(t.state, t.runAt), index('jobs_ws_type_state').on(t.workspaceId, t.type, t.state), index('jobs_ws_state').on(t.workspaceId,t.state),
  index('jobs_claim').on(t.state,sql`${t.priority} desc`,t.runAt,t.createdAt),index('jobs_type_state').on(t.type,t.state),index('jobs_stalled').on(t.state,t.leaseUntil),
  index('jobs_destination').on(t.workspaceId,t.type,t.state,sql`json_extract(${t.payloadJson}, '$.accountId')`),index('jobs_batch').on(t.workspaceId,sql`json_extract(${t.payloadJson}, '$.batchId')`)])

export const jobAttempts = sqliteTable('job_attempts', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  outcome: text('outcome', { enum: ['ok', 'retry', 'failed', 'lease_expired'] }),
  errorCode: text('error_code'),
  errorMessage: text('error_message')
}, t=>[index('job_attempts_job_started').on(t.jobId,t.startedAt),index('job_attempts_started').on(t.startedAt)])

export const destinationAccounts = sqliteTable('destination_accounts', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), providerId: text('provider_id').notNull(),
  username: text('username').notNull(), revision: text('revision').notNull(), validatedAt: text('validated_at').notNull(),
  state: text('state').notNull().default('connected'), expiresAt: text('expires_at'),
  permissionsJson: text('permissions_json').notNull().default('[]')
}, t => [primaryKey({ columns: [t.workspaceId, t.provider, t.providerId] })])

export const providerLimits = sqliteTable('provider_limits', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), accountId: text('account_id').notNull(), operation: text('operation').notNull(),
  cooldownUntil: text('cooldown_until').notNull(), failures: integer('failures').notNull().default(0)
}, t => [primaryKey({ columns: [t.workspaceId, t.provider, t.accountId, t.operation] })])

/**
 * Last answer of the provider's publishing-limit endpoint per account. Values come from the API at runtime;
 * the last valid reading is kept next to the last attempt, so errors and staleness stay explicit.
 */
export const providerQuotaSnapshots = sqliteTable('provider_quota_snapshots', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), accountId: text('account_id').notNull(),
  source: text('source').notNull(),
  quotaUsage: integer('quota_usage'), quotaTotal: integer('quota_total'), quotaDurationSec: integer('quota_duration_sec'),
  fetchedAt: text('fetched_at'),
  attemptedAt: text('attempted_at').notNull(),
  lastStatus: text('last_status', { enum: ['ok', 'error'] }).notNull(),
  errorKind: text('error_kind'), errorMessage: text('error_message')
}, t => [primaryKey({ columns: [t.workspaceId, t.provider, t.accountId] })])

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
  postId: text('post_id'), assetSha: text('asset_sha'), mediaId: text('media_id'),
  provenanceJson: text('provenance_json').notNull(), publishedAt: text('published_at').notNull(),
  cleanupState: text('cleanup_state').notNull().default('kept')
}, t => [index('publication_history_ws_account').on(t.workspaceId, t.accountId), index('publication_history_ws_sha').on(t.workspaceId, t.assetSha, t.publishedAt)])

export const publicationContainers = sqliteTable('publication_containers', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  requestId: text('request_id').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  technicalBatchId: text('technical_batch_id'),
  name: text('name').notNull(),
  provider: text('provider', { enum: ['instagram'] }),
  destinationAccountId: text('destination_account_id'),
  accountRevision: text('account_revision'),
  timeZone: text('time_zone').notNull(),
  plannedStartAt: text('planned_start_at'),
  plannedEndAt: text('planned_end_at'),
  intervalMin: integer('interval_min').notNull().default(15),
  /** Trial reels (Meta trial_params): shown first to non-followers; null publishes a regular reel. */
  trialGraduation: text('trial_graduation', { enum: ['MANUAL', 'SS_PERFORMANCE'] }),
  captionBase: text('caption_base').notNull().default(''),
  visualSnapshotJson: text('visual_snapshot_json').notNull().default('{"version":1}'),
  scheduledAt: text('scheduled_at'),
  scheduledRevision: integer('scheduled_revision'),
  controlState: text('control_state', { enum: ['active', 'paused', 'cancelled'] }).notNull().default('active'),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
}, t => [
  uniqueIndex('publication_containers_ws_id').on(t.workspaceId, t.id),
  uniqueIndex('publication_containers_request').on(t.workspaceId, t.requestId),
  index('publication_containers_created').on(t.workspaceId, t.createdAt, t.id),
  index('publication_containers_planned').on(t.workspaceId, t.plannedStartAt, t.id),
  foreignKey({ columns: [t.workspaceId, t.provider, t.destinationAccountId], foreignColumns: [destinationAccounts.workspaceId, destinationAccounts.provider, destinationAccounts.providerId] }),
  check('publication_containers_control', sql`${t.controlState} in ('active','paused','cancelled')`),
  check('publication_containers_interval', sql`${t.intervalMin} between 15 and 10080`),
  check('publication_containers_provider', sql`${t.provider} is null or ${t.provider} = 'instagram'`),
  check('publication_containers_destination', sql`(${t.provider} is null) = (${t.destinationAccountId} is null)`),
  check('publication_containers_plan', sql`${t.scheduledAt} is null or (${t.destinationAccountId} is not null and ${t.accountRevision} is not null and ${t.plannedStartAt} is not null and ${t.plannedEndAt} is not null)`)
])

export const publicationContainerItems = sqliteTable('publication_container_items', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(),
  containerId: text('container_id').notNull(), position: integer('position').notNull(),
  assetId: text('asset_id'), sourceSnapshotJson: text('source_snapshot_json').notNull(),
  captionOverride: text('caption_override'), plannedPublishAt: text('planned_publish_at'),
  recipeVersionId: text('recipe_version_id'),
  shareToFeed: integer('share_to_feed', { mode: 'boolean' }).notNull().default(true),
  allowRepost: integer('allow_repost', { mode: 'boolean' }).notNull().default(false),
  effectiveSnapshotJson: text('effective_snapshot_json'), jobId: text('job_id'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
}, t => [
  uniqueIndex('publication_container_items_order').on(t.workspaceId, t.containerId, t.position),
  uniqueIndex('publication_container_items_job').on(t.jobId),
  index('publication_container_items_asset').on(t.workspaceId, t.assetId),
  foreignKey({ columns: [t.workspaceId, t.containerId], foreignColumns: [publicationContainers.workspaceId, publicationContainers.id] }),
  foreignKey({ columns: [t.workspaceId, t.assetId], foreignColumns: [mediaAssets.workspaceId, mediaAssets.id] }),
  foreignKey({ columns: [t.workspaceId, t.jobId], foreignColumns: [jobs.workspaceId, jobs.id] }),
  check('publication_container_items_position', sql`${t.position} >= 0`)
])

/** Explicit, user-chosen changes to a scheduled Container's plan (PR 07). Nothing changes the plan silently. */
export const publicationContainerAdjustments = sqliteTable('publication_container_adjustments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  containerId: text('container_id').notNull().references(() => publicationContainers.id),
  kind: text('kind', { enum: ['keep', 'reduce', 'move', 'drag'] }).notNull(),
  beforeJson: text('before_json').notNull(), afterJson: text('after_json').notNull(),
  createdAt: text('created_at').notNull()
}, t => [index('publication_container_adjustments_ws_container').on(t.workspaceId, t.containerId, t.createdAt)])
