import { beforeEach, afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import type { Ctx } from '../context'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset, getAsset } from '../repos/assets'
import { addProfileFromUrl } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { jobs, remotePosts, publicationHistory } from '../db/schema'
import { enqueue } from '../queue/queue'
import { recordPublication, history } from './publication-history'
import { queryGrid } from './grid'
import { deleteMany, mediaDetails, pendingMedia } from './media-manager'
let ctx: Ctx; let ws: string; let postId: string; let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'legacy-manager-')); ctx = { db: memDb(), dataRoot: root, clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  await mkdir(join(root, 'copy')); await writeFile(join(root, 'copy/original.mp4'), 'copy'); await writeFile(join(root, 'user.mp4'), 'original')
  insertAsset(ctx.db, { id: 'a', workspaceId: ws, origin: 'ig_third_party', sourceName: 'source.mp4', filePath: join(root, 'copy/original.mp4'), sha256: 'sha', audioCodec: 'aac', videoCodec: 'h264', sizeBytes: 4, durationMs: 4000, width: 1080, height: 1920, validationJson: '{}', importedAt: ctx.clock().toISOString() })
  const profile = addProfileFromUrl(ctx, ws, '@origin'); postId = addReelLink(ctx, ws, profile.id, 'https://instagram.com/reel/ABCDE/').id
  ctx.db.update(remotePosts).set({ assetId: 'a', caption: 'Interesting caption', views: 1000, likes: 50, comments: null, metricsUpdatedAt: ctx.clock().toISOString() }).where(eq(remotePosts.id, postId)).run()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const grid = (extra = {}) => queryGrid(ctx.db, { workspaceId: ws, source: 'library', sortBy: 'importedAt', sortDir: 'desc', limit: 10, offset: 0, ...extra })
it('searches captions and origins; unknown metrics remain null; counts are filtered', () => {
  expect(grid({ text: 'interesting' }).total).toBe(1); expect(grid({ text: 'origin' }).total).toBe(1)
  expect(grid({ sourceProfile: '@origin' }).items[0].metrics.comments).toBeNull()
  expect(grid({ sourceProfile: 'missing' }).total).toBe(0)
  expect(grid({ platform: 'tiktok' }).total).toBe(0)
})
it('status follows queue and ledger rather than export success', async () => {
  const j = enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: 'Publish', payload: { postId, username: 'owner' } }, ctx.clock())
  expect(grid({ status: 'scheduled' }).total).toBe(1)
  ctx.db.update(jobs).set({ state: 'failed', lastError: 'Expired token' }).where(eq(jobs.id, j.id)).run()
  expect(grid({ status: 'failed' }).items[0].status).toBe('failed')
  ctx.db.update(jobs).set({ state: 'done' }).where(eq(jobs.id, j.id)).run()
  expect(grid({ status: 'published' }).total).toBe(0)
  await recordPublication(ctx, { workspaceId: ws, jobId: j.id, postId, accountId: '123', username: 'owner', mediaId: '999' })
  expect(grid({ publicationAccount: '@owner', status: 'published' }).total).toBe(1)
  expect(grid({ status: 'unpublished' }).total).toBe(0)
  const d = await mediaDetails(ctx, ws, 'a'); expect(d.audioCodec).toBe('aac'); expect(d.publicationTotal).toBe(1); expect(d.sourceProfile).toBe('origin')
})
it('bulk delete protects active references, preserves originals and confirmed history', async () => {
  const j = enqueue(ctx.db, { workspaceId: ws, type: 'export_tiktok', label: 'Export', payload: { assetIds: ['a'] } }, ctx.clock())
  expect(await deleteMany(ctx, ws, ['a'])).toMatchObject({ blocked: ['a'], deleted: [] })
  ctx.db.update(jobs).set({ state: 'done' }).where(eq(jobs.id, j.id)).run()
  await recordPublication(ctx, { workspaceId: ws, jobId: 'confirmed', postId, accountId: '123', username: 'owner' })
  expect((await deleteMany(ctx, ws, ['a', 'a'])).deleted).toEqual(['a']); expect(getAsset(ctx.db, ws, 'a')).toBeNull()
  expect(history(ctx, ws)).toHaveLength(1); expect((await stat(join(root, 'user.mp4'))).isFile()).toBe(true)
})
it('protects scheduled local snapshot even when the origin association changes', async () => {
  enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: 'Publish', payload: { localAssetId: 'a', postId: 'detached' } }, ctx.clock())
  expect((await deleteMany(ctx, ws, ['a'])).blocked).toEqual(['a'])
  const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
  expect((await deleteMany(ctx, other, ['a'])).failed).toEqual(['a']); expect(pendingMedia(ctx, other)).toEqual([])
  await expect(mediaDetails(ctx, other, 'a')).rejects.toThrow()
})

it('retains publication-before-download relationships when the ledger has no SHA', async () => {
  ctx.db.insert(publicationHistory).values({ jobId: 'online', workspaceId: ws, accountId: '123', username: 'owner', postId, assetSha: null, provenanceJson: '{}', publishedAt: ctx.clock().toISOString() }).run()
  expect(grid({ status: 'published', publicationAccount: 'owner' }).items[0].publishedAccounts).toEqual(['owner'])
  expect((await mediaDetails(ctx, ws, 'a')).publicationTotal).toBe(1)
})
