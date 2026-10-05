import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { insertAsset, getAsset } from '../repos/assets'
import { remotePosts } from '../db/schema'
import { enqueue } from '../queue/queue'
import { recordPublication, history } from './publication-history'
import { achievements } from './achievements'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { MIGRATIONS_DIR } from '../test-utils'
import { jobs } from '../db/schema'
let ctx: Ctx; let ws: string; let postId: string; let root: string; let file: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'legacy-history-')); ctx = { db: memDb(), dataRoot: root, clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  const p = addProfileFromUrl(ctx, ws, '@source'); postId = addReelLink(ctx, ws, p.id, 'https://www.instagram.com/reel/ABCDE/').id
  file = join(root, 'copy', 'original.mp4'); await mkdir(join(root, 'copy')); await writeFile(file, 'test copy'); await writeFile(join(root, 'user-original.mp4'), 'original')
  insertAsset(ctx.db, { id: 'asset', workspaceId: ws, origin: 'ig_third_party', sourceName: 'reel', filePath: file, sha256: 'hash', sizeBytes: 9, durationMs: 1000, width: 1080, height: 1920, videoCodec: 'h264', validationJson: '{}', importedAt: ctx.clock().toISOString() })
  ctx.db.update(remotePosts).set({ assetId: 'asset', views: 150000, likes: 10, comments: 3 }).where(eq(remotePosts.id, postId)).run()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const record = (cleanup = false) => recordPublication(ctx, { workspaceId: ws, jobId: 'confirmed-job', accountId: '123', username: 'owner', postId, mediaId: '999', cleanup })
it('registro idempotente mantém proveniência e cópia por padrão', async () => {
  await record(); await record(); expect(history(ctx, ws)).toHaveLength(1)
  expect(JSON.parse(history(ctx, ws)[0].provenanceJson)).toMatchObject({ profile: 'source', views: 150000, comments: 3 })
  expect(getAsset(ctx.db, ws, 'asset')).not.toBeNull(); expect((await stat(file)).isFile()).toBe(true)
})
it('limpeza opt-in preserva original e histórico após apagar a cópia', async () => {
  expect((await record(true)).cleanupState).toBe('deleted')
  expect(getAsset(ctx.db, ws, 'asset')).toBeNull(); await expect(stat(file)).rejects.toThrow()
  expect((await stat(join(root, 'user-original.mp4'))).isFile()).toBe(true)
  expect(history(ctx, ws)[0].assetSha).toBe('hash')
  expect(achievements(ctx, ws).streaks[0]).toMatchObject({ current: 1, today: true })
})
it('mantém mídia usada por tarefa pendente', async () => {
  enqueue(ctx.db, { workspaceId: ws, type: 'export_tiktok', label: 'Outro lote', payload: { assetIds: ['asset'] } }, ctx.clock())
  expect((await record(true)).cleanupState).toBe('kept_in_use'); expect(getAsset(ctx.db, ws, 'asset')).not.toBeNull()
})
it('isola contas/workspaces e não conta agendamentos na ofensiva', async () => {
  const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
  enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: 'Pendente', payload: {} }, ctx.clock())
  expect(achievements(ctx, ws).streaks).toEqual([])
  await record(); expect(history(ctx, other)).toEqual([]); expect(achievements(ctx, other).streaks).toEqual([])
})
it('migração recupera publicações confirmadas antigas sem contar falhas', () => {
  const old = enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: 'Publicar reel em @owner', payload: { postId, accountId: '123' } }, ctx.clock())
  ctx.db.update(jobs).set({ state: 'done', resultJson: JSON.stringify({ mediaId: '999' }) }).where(eq(jobs.id, old.id)).run()
  enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: 'Pendente', payload: { postId, accountId: '123' } }, ctx.clock())
  const client = ctx.db as unknown as { $client: { exec(sql: string): void } }
  client.$client.exec('DROP TABLE publication_history; DELETE FROM __drizzle_migrations WHERE created_at = 1791220800000;')
  migrate(ctx.db, { migrationsFolder: MIGRATIONS_DIR })
  expect(history(ctx, ws)).toHaveLength(1); expect(history(ctx, ws)[0]).toMatchObject({ username: 'owner', assetSha: 'hash', mediaId: '999' })
  migrate(ctx.db, { migrationsFolder: MIGRATIONS_DIR }); expect(history(ctx, ws)).toHaveLength(1)
})
it('limpeza não remove arquivo baixado depois do agendamento', async () => {
  const r = await recordPublication(ctx, { workspaceId: ws, jobId: 'remote-only', accountId: '123', username: 'owner', postId, cleanup: true, cleanupAssetId: null })
  expect(r.cleanupState).toBe('no_local_copy'); expect(getAsset(ctx.db, ws, 'asset')).not.toBeNull()
})
