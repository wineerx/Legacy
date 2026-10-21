import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { containerVisualSnapshot, defaultWatermark, watermarkGeometry, type ContainerVisualSnapshot } from '@shared/container-visual'
import { memDb } from '../test-utils'
import type { Ctx } from '../context'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset, insertVersion, listVersions } from '../repos/assets'
import { jobs, mediaVersions, publicationContainers } from '../db/schema'
import { runTool } from '../media/run'
import * as toolRunner from '../media/run'
import { ffmpegPaths } from '../media/ffmpeg-bin'
import * as ops from '../media/ops'
import { createContainer, updateContainerDraft, scheduleContainer, readContainer } from './publication-containers'
import { materializeVersion, processedCacheDir } from './versions'
import { connectInstagram } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { recipeVisualOverride, resolveVisual, visualPreviewOverrides } from './container-visual'

const fixtures = mkdtempSync(join(tmpdir(), 'legacy-visual-fixtures-'))
const video = join(fixtures, 'original.mp4')
let red: string, blue: string, green: string, ctx: Ctx, ws: string, revision: string, root: string
const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
const ff = (args: string[]) => runTool(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', ...args])
beforeAll(async () => {
  await ff(['-f', 'lavfi', '-i', 'color=black:s=360x640:r=30:d=3', '-c:v', 'mpeg4', video])
  for (const color of ['red', 'blue', 'green']) await ff(['-f', 'lavfi', '-i', `color=${color}:s=100x50`, '-frames:v', '1', join(fixtures, `${color}.png`)])
  ;[red, blue, green] = ['red', 'blue', 'green'].map(c => `data:image/png;base64,${readFileSync(join(fixtures, `${c}.png`)).toString('base64')}`)
})
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legacy-container-visual-'))
  ctx = { db: memDb(), dataRoot: root, clock: () => new Date('2026-10-09T15:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'Visual QA', timeZone: 'UTC' }).id
  ctx.secret = (workspace, key) => decryptSecret(ctx, vault, workspace, key)
  revision = (await connectInstagram(ctx, vault, ws, 'synthetic', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'qa' }))).revision
  for (const id of ['a', 'b']) insertAsset(ctx.db, { id, workspaceId: ws, origin: 'pc', sourceName: `${id}.mp4`, filePath: video, sha256: id, sizeBytes: readFileSync(video).length, durationMs: 3000, width: 360, height: 640, videoCodec: 'mpeg4', validationJson: '{}', importedAt: ctx.clock().toISOString() })
})
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
afterAll(() => rmSync(fixtures, { recursive: true, force: true }))
const watermark = (position: NonNullable<ContainerVisualSnapshot['watermark']>['position'] = 'bottom-right', opacityPct = 50): ContainerVisualSnapshot => ({ version: 1, watermark: { ...defaultWatermark(), enabled: true, imageData: red, position, scalePct: 20, opacityPct } })
function draft(visualSnapshot: ContainerVisualSnapshot, items = [{ assetId: 'a' }]) {
  return createContainer(ctx, ws, randomUUID(), { name: 'Visual', provider: 'instagram', destinationAccountId: '111', accountRevision: revision, plannedStartAt: '2026-10-09T16:00:00Z', intervalMin: 15, visualSnapshot, items })
}
function recipe(detail: ReturnType<typeof scheduleContainer>) {
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, detail.jobs[0].id)).get()!
  return JSON.parse(job.payloadJson).versionId as string
}
async function pixel(path: string, time: number, x: number, y: number) {
  const out = join(root, `${randomUUID()}.rgb`)
  await ff(['-ss', String(time), '-i', path, '-vf', `crop=8:8:${x}:${y},scale=1:1`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', out])
  return [...readFileSync(out)]
}
it('accepts legacy snapshots and rejects incomplete images, bounds and banner windows', () => {
  expect(containerVisualSnapshot.parse({ version: 1 })).toEqual({ version: 1 })
  expect(containerVisualSnapshot.safeParse({ ...watermark(), watermark: { ...watermark().watermark, imageData: 'bad' } }).success).toBe(false)
  expect(containerVisualSnapshot.safeParse({ ...watermark(), watermark: { ...watermark().watermark, opacityPct: 101 } }).success).toBe(false)
  expect(containerVisualSnapshot.safeParse({ version: 1, banner: { enabled: true, imageData: blue, startMs: 2000, endMs: 1000 } }).success).toBe(false)
})
it('draft create/update produce zero jobs, recipes, files or FFmpeg; off schedules the original', () => {
  const tools = vi.spyOn(toolRunner, 'runTool'), render = vi.spyOn(ops, 'renderVideoVersion'), original = readFileSync(video)
  const d = draft(watermark())
  const updated = updateContainerDraft(ctx, ws, d.container.id, 1, { name: 'Off', provider: 'instagram', destinationAccountId: '111', accountRevision: revision, plannedStartAt: '2026-10-09T16:00:00Z', visualSnapshot: { version: 1, watermark: { ...defaultWatermark(), imageData: red } }, items: [{ assetId: 'a' }] })
  expect(ctx.db.select().from(jobs).all()).toHaveLength(0)
  expect(ctx.db.select().from(mediaVersions).all()).toHaveLength(0)
  expect(readdirSync(root)).toEqual([])
  expect(render).not.toHaveBeenCalled(); expect(tools).not.toHaveBeenCalled()
  const result = scheduleContainer(ctx, ws, d.container.id, updated.container.revision)
  expect(recipe(result)).toBeUndefined()
  expect(ctx.db.select().from(mediaVersions).all()).toHaveLength(0)
  expect(readFileSync(video)).toEqual(original)
})
it('freezes visual JSON and recipe, replays identical jobs and rolls back generated recipes on later failure', () => {
  const d = draft(watermark()), result = scheduleContainer(ctx, ws, d.container.id, 1)
  const frozen = ctx.db.select().from(publicationContainers).where(eq(publicationContainers.id, d.container.id)).get()!.visualSnapshotJson
  expect(scheduleContainer(ctx, ws, d.container.id, 1).jobs).toEqual(result.jobs)
  expect(ctx.db.select().from(mediaVersions).all()).toHaveLength(1)
  expect(() => updateContainerDraft(ctx, ws, d.container.id, result.detail.container.revision, { name: 'Changed', visualSnapshot: { version: 1 } })).toThrow(/rascunhos/)
  expect(ctx.db.select().from(publicationContainers).where(eq(publicationContainers.id, d.container.id)).get()!.visualSnapshotJson).toBe(frozen)
  const broken = draft(watermark(), [{ assetId: 'a', allowRepost: true } as any, { assetId: 'b', recipeVersionId: 'missing' } as any])
  ctx.db.update(publicationContainers).set({ plannedStartAt: '2026-10-10T16:00:00Z' }).where(eq(publicationContainers.id, broken.container.id)).run()
  const before = readContainer(ctx, ws, broken.container.id)
  expect(() => scheduleContainer(ctx, ws, broken.container.id, 1)).toThrow(/Versão editada/)
  expect(readContainer(ctx, ws, broken.container.id)).toEqual(before)
  expect(ctx.db.select().from(mediaVersions).all()).toHaveLength(1)
  expect(ctx.db.select().from(jobs).all()).toHaveLength(1)
  expect(readdirSync(root)).toEqual([])
})
it('retains individual layers and baked versions, with workspace-scoped preview', () => {
  insertVersion(ctx.db, { id: 'individual', workspaceId: ws, assetId: 'a', kind: 'banner', filePath: video, paramsJson: JSON.stringify({ pending: true, bannerPath: join(fixtures, 'blue.png'), startMs: 1000, endMs: 2000 }), createdAt: ctx.clock().toISOString() })
  const common = { ...watermark(), banner: { enabled: true, imageData: red, startMs: 0, endMs: 3000 }, cover: { enabled: true, imageData: green } }
  const override = recipeVisualOverride(ctx, ws, 'a', 'individual')
  expect(resolveVisual(common, override)).toMatchObject({ watermark: common.watermark, banner: { path: join(fixtures, 'blue.png'), startMs: 1000, firstFrame: true }, cover: { imageData: green } })
  expect(visualPreviewOverrides(ctx, ws, 'a', 'individual').banner?.path).toBe(join(fixtures, 'blue.png'))
  expect(() => visualPreviewOverrides(ctx, 'other', 'a', 'individual')).toThrow(/workspace/)
  expect(resolveVisual(common, { sourcePath: video })).toEqual({ watermark: common.watermark, sourcePath: video })
})
it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const)('JIT %s matches preview geometry/opacity and cache retry, preserving original', async position => {
  const original = readFileSync(video), visual = watermark(position)
  const d = draft(visual), result = scheduleContainer(ctx, ws, d.container.id, 1), id = recipe(result)
  expect(existsSync(processedCacheDir(ctx, ws))).toBe(false)
  const render = vi.spyOn(ops, 'renderVideoVersion')
  const path = await materializeVersion(ctx, ws, 'a', id)
  const geometry = watermarkGeometry(360, 640, { width: 100, height: 50 }, visual.watermark!)
  const rgb = await pixel(path, 1, geometry.x + 12, geometry.y + 12)
  expect(rgb[0]).toBeGreaterThan(110); expect(rgb[0]).toBeLessThan(145)
  expect(rgb[1]).toBeLessThan(15); expect(rgb[2]).toBeLessThan(15)
  expect(await pixel(path, 1, 180, 500)).toEqual([0, 0, 0])
  expect(await materializeVersion(ctx, ws, 'a', id)).toBe(path)
  expect(render).toHaveBeenCalledTimes(1)
  expect(readFileSync(video)).toEqual(original)
  expect(readdirSync(processedCacheDir(ctx, ws)).filter(p => p.includes('.partial.'))).toEqual([])
}, 30_000)
it('banner honors its window and cover occupies the first frame; frozen hash rejects tampering', async () => {
  const visual: ContainerVisualSnapshot = { version: 1, banner: { enabled: true, imageData: blue, startMs: 1000, endMs: 2000 }, cover: { enabled: true, imageData: green } }
  const d = draft(visual), result = scheduleContainer(ctx, ws, d.container.id, 1), id = recipe(result)
  const path = await materializeVersion(ctx, ws, 'a', id)
  const first = await pixel(path, 0, 180, 320)
  expect(first[1]).toBeGreaterThan(100); expect(first[0]).toBeLessThan(15)
  expect(await pixel(path, 0.5, 180, 320)).toEqual([0, 0, 0])
  const during = await pixel(path, 1.5, 180, 320)
  expect(during[2]).toBeGreaterThan(230)
  expect(await pixel(path, 2.5, 180, 320)).toEqual([0, 0, 0])
  ctx.db.update(publicationContainers).set({ visualSnapshotJson: '{"version":1}' }).where(eq(publicationContainers.id, d.container.id)).run()
  await expect(materializeVersion(ctx, ws, 'a', id)).rejects.toThrow(/congelado/)
}, 30_000)

it('individual banner remains effective under common watermark and scheduling preserves its override id', async () => {
  insertVersion(ctx.db, { id: 'individual', workspaceId: ws, assetId: 'a', kind: 'banner', filePath: video, paramsJson: JSON.stringify({ pending: true, bannerPath: join(fixtures, 'blue.png'), startMs: 1000, endMs: 2000 }), createdAt: ctx.clock().toISOString() })
  const visual = { ...watermark('top-right', 100), banner: { enabled: true, imageData: red, startMs: 0, endMs: 3000 } }
  const d = draft(visual, [{ assetId: 'a', recipeVersionId: 'individual' } as any]), result = scheduleContainer(ctx, ws, d.container.id, 1)
  expect(result.detail.items[0].recipeVersionId).toBe('individual')
  const id = recipe(result)
  expect(id).not.toBe('individual')
  const path = await materializeVersion(ctx, ws, 'a', id)
  expect((await pixel(path, 0, 180, 320))[2]).toBeGreaterThan(230)
  expect(await pixel(path, 0.5, 180, 320)).toEqual([0, 0, 0])
  expect((await pixel(path, 1.5, 180, 320))[2]).toBeGreaterThan(230)
  expect((await pixel(path, 1.5, 293, 19))[0]).toBeGreaterThan(230)
}, 30_000)
it('zero opacity schedules original without a new recipe', () => {
  const d = draft(watermark('center', 0)), result = scheduleContainer(ctx, ws, d.container.id, 1)
  expect(recipe(result)).toBeUndefined()
  expect(listVersions(ctx.db, ws, 'a')).toHaveLength(0)
})
