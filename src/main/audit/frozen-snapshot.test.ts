/**
 * Phase 1 audit (PR 05): the frozen intention of a scheduled Container, traced end to end.
 * Template version → draft → schedule → per-item snapshot → recipe → job → JIT render → retry/restart.
 * FFmpeg is real; the Canvas rasterizer is replaced by a recorder so the frozen layout it receives is observable.
 */
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, copyFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import type { Ctx } from '../context'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { destinationAccounts, jobs, mediaVersions, publicationContainerItems, publicationContainers, visualTemplates, visualTemplateVersions } from '../db/schema'
import { runTool } from '../media/run'
import { ffmpegPaths } from '../media/ffmpeg-bin'
import { blankLayout, newElement, RENDERER_VERSION, type VisualLayout } from '@shared/visual-layout'
import type { VisualRaster } from '@shared/visual-raster'
import { connectInstagram, publishInstagram } from '../services/instagram-publishing'
import { decryptSecret } from '../services/integrations'
import { createContainer, scheduleContainer, updateContainerDraft, readContainer } from '../services/publication-containers'
import { createTemplate, saveTemplateVersion, archiveTemplate, deleteTemplate, applyTemplate } from '../services/visual-templates'
import { materializeVersion } from '../services/versions'

const fixtures = mkdtempSync(join(tmpdir(), 'legacy-frozen-fixtures-'))
const ff = (args: string[]) => runTool(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', ...args])
const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
let background: string, layer: string, logo: string
let ctx: Ctx, ws: string, root: string, video: string, other: string, revision: string, rendered: VisualLayout[]

beforeAll(async () => {
  await ff(['-f', 'lavfi', '-i', 'color=black:s=360x640:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', join(fixtures, 'original.mp4')])
  await ff(['-f', 'lavfi', '-i', 'color=blue:s=360x640:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', join(fixtures, 'other.mp4')])
  await ff(['-f', 'lavfi', '-i', 'color=white:s=360x640', '-frames:v', '1', join(fixtures, 'bg.png')])
  await ff(['-f', 'lavfi', '-i', 'color=black@0:s=360x640,format=rgba', '-frames:v', '1', join(fixtures, 'layer.png')])
  await ff(['-f', 'lavfi', '-i', 'color=red:s=40x40', '-frames:v', '1', join(fixtures, 'logo.png')])
  const data = (f: string) => `data:image/png;base64,${readFileSync(join(fixtures, f)).toString('base64')}`
  ;[background, layer, logo] = [data('bg.png'), data('layer.png'), data('logo.png')]
}, 60_000)
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legacy-frozen-'))
  video = join(root, 'original.mp4'); copyFileSync(join(fixtures, 'original.mp4'), video)
  other = join(root, 'other.mp4'); copyFileSync(join(fixtures, 'other.mp4'), other)
  rendered = []
  ctx = { db: memDb(), dataRoot: root, clock: () => new Date('2026-10-09T15:00:00Z'), renderVisual: recorder }
  ws = createWorkspace(ctx.db, { name: 'Frozen audit', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (workspace, key) => decryptSecret(ctx, vault, workspace, key)
  revision = (await connectInstagram(ctx, vault, ws, 'synthetic', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'qa' }))).revision
  for (const [id, file] of [['a', video], ['b', other]]) insertAsset(ctx.db, { id, workspaceId: ws, origin: 'pc', sourceName: `${id}.mp4`, filePath: file, sha256: sha(file), sizeBytes: readFileSync(file).length, durationMs: 2000, width: 360, height: 640, videoCodec: 'mpeg4', validationJson: '{}', importedAt: ctx.clock().toISOString() })
})
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
afterAll(() => rmSync(fixtures, { recursive: true, force: true }))

async function recorder(layout: VisualLayout): Promise<VisualRaster> {
  rendered.push(structuredClone(layout))
  return { background, layers: layout.elements.filter(e => e.type !== 'media').map(e => ({ id: e.id, png: layer })) }
}
const templateLayout = (text: string, bg = '#ffffff'): VisualLayout => ({ ...blankLayout(), width: 360, height: 640, background: bg, elements: [
  { ...newElement('media', 'media'), x: 0, y: 160, width: 360, height: 480 },
  { ...newElement('text', 'title'), x: 10, y: 10, width: 340, height: 140, fontSize: 20, text },
  { ...newElement('image', 'logo'), x: 300, y: 10, width: 40, height: 40, imageData: logo }
] })
const TEXT = '{{caption}} · @{{username}} · {{custom_text}}'

/** Template v1 → applied by the service → scheduled with two items whose effective captions differ. */
function scheduled() {
  const t = createTemplate(ctx, ws, randomUUID(), { name: 'Meme', visual: { version: 2, layout: templateLayout(TEXT), context: { username: 'qa', custom_text: 'fixo', caption: 'teste do editor' } } })
  const draft = { name: 'Audit', provider: 'instagram' as const, destinationAccountId: '111', accountRevision: revision, plannedStartAt: '2026-10-10T16:00:00Z', intervalMin: 15, captionBase: 'legenda base', items: [{ assetId: 'a', captionOverride: 'legenda A' }, { assetId: 'b' }] }
  const d = createContainer(ctx, ws, randomUUID(), draft)
  const applied = applyTemplate(ctx, ws, d.container.id, d.container.revision, draft, t.template.id, 1)
  const result = scheduleContainer(ctx, ws, d.container.id, applied.container.revision)
  const payloads = result.jobs.map(j => JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, j.id)).get()!.payloadJson))
  return { t, d, draft, result, payloads, revision: applied.container.revision }
}
const textOf = (layout: VisualLayout) => layout.elements.find(e => e.id === 'title')
const recipeRow = (versionId: string) => ctx.db.select().from(mediaVersions).where(eq(mediaVersions.id, versionId)).get()!

it('1–2: schedule freezes composition, embedded images, renderer version and each item’s effective caption/context', async () => {
  const { payloads } = scheduled()
  expect(payloads.map(p => p.caption)).toEqual(['legenda A', 'legenda base'])
  const params = payloads.map(p => JSON.parse(recipeRow(p.versionId).paramsJson))
  expect(params.map(p => p.layoutContext)).toEqual([
    { username: 'qa', custom_text: 'fixo', caption: 'legenda A' },
    { username: 'qa', custom_text: 'fixo', caption: 'legenda base' }])
  expect(params.every(p => p.rendererVersion === RENDERER_VERSION && /^[0-9a-f]{64}$/.test(p.recipeSha256) && p.sourceSha256)).toBe(true)
  expect(params.map(p => p.sourceSha256)).toEqual([sha(video), sha(other)])
  await materializeVersion(ctx, ws, 'a', payloads[0].versionId)
  await materializeVersion(ctx, ws, 'b', payloads[1].versionId)
  expect(rendered.map(l => textOf(l))).toMatchObject([{ text: 'legenda A · @qa · fixo' }, { text: 'legenda base · @qa · fixo' }])
  expect(rendered[0].elements.find(e => e.id === 'logo')).toMatchObject({ imageData: logo })
})

it('3–4: editing, renaming, archiving and deleting the Template, or renaming the account, never reaches retry, cache hit or restart', async () => {
  const { t, payloads, result } = scheduled()
  const before = sha(video)
  const first = await materializeVersion(ctx, ws, 'a', payloads[0].versionId), firstBytes = sha(first), firstLayout = rendered[0]
  // Every later change a user can make to the origin, plus the destination's display name.
  const v2 = saveTemplateVersion(ctx, ws, t.template.id, 1, randomUUID(), { name: 'Renomeado', visual: { version: 2, layout: templateLayout('outro texto', '#000000'), context: { username: 'outra' } } })
  const archived = archiveTemplate(ctx, ws, t.template.id, v2.template.revision, true)
  deleteTemplate(ctx, ws, t.template.id, archived.template.revision)
  expect(ctx.db.select().from(visualTemplates).all()).toHaveLength(0)
  expect(ctx.db.select().from(visualTemplateVersions).all()).toHaveLength(0)
  ctx.db.update(destinationAccounts).set({ username: 'renomeada' }).where(eq(destinationAccounts.providerId, '111')).run()
  // Cache hit: same derivation, renderer not called again.
  expect(await materializeVersion(ctx, ws, 'a', payloads[0].versionId)).toBe(first)
  expect(rendered).toHaveLength(1)
  // Restart: fresh context, cache file gone → the same frozen layout is rendered again from persisted data only.
  rmSync(first); rmSync(`${first}.json`)
  const restarted: Ctx = { db: ctx.db, dataRoot: root, clock: ctx.clock, renderVisual: recorder }
  const again = await materializeVersion(restarted, ws, 'a', payloads[0].versionId)
  expect(again).toBe(first)
  expect(rendered[1]).toEqual(firstLayout)
  expect(textOf(rendered[1])).toMatchObject({ text: 'legenda A · @qa · fixo' })
  expect(rendered[1].background).toBe('#ffffff')
  expect(existsSync(again) && sha(again)).toBeTruthy()
  // The job and its recipe are untouched by the Template lifecycle.
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, result.jobs[0].id)).get()!.payloadJson)).toEqual(payloads[0])
  expect(sha(video)).toBe(before)
  void firstBytes
})

it('5: repeating schedule with the same revision returns the same jobs and creates no extra recipes', () => {
  const { d, result, revision: r } = scheduled()
  const recipes = ctx.db.select().from(mediaVersions).all().length, jobCount = ctx.db.select().from(jobs).all().length
  expect(scheduleContainer(ctx, ws, d.container.id, r).jobs.map(j => j.id)).toEqual(result.jobs.map(j => j.id))
  expect(ctx.db.select().from(mediaVersions).all()).toHaveLength(recipes)
  expect(ctx.db.select().from(jobs).all()).toHaveLength(jobCount)
  expect(() => updateContainerDraft(ctx, ws, d.container.id, readContainer(ctx, ws, d.container.id).container.revision, { name: 'x' })).toThrow(/rascunhos/)
})

it('6: v1 snapshots keep their recipe shape and render; the original keeps its bytes', async () => {
  const before = sha(video)
  const d = createContainer(ctx, ws, randomUUID(), { name: 'V1', provider: 'instagram', destinationAccountId: '111', accountRevision: revision, plannedStartAt: '2026-10-10T16:00:00Z', items: [{ assetId: 'a' }],
    visualSnapshot: { version: 1, banner: { enabled: true, imageData: logo, startMs: 0, endMs: 1000 } } })
  const job = scheduleContainer(ctx, ws, d.container.id, d.container.revision).jobs[0]
  const versionId = JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.payloadJson).versionId
  const params = JSON.parse(recipeRow(versionId).paramsJson)
  expect(params.rendererVersion).toBeUndefined()
  expect(params.layoutContext).toBeUndefined()
  expect(existsSync(await materializeVersion(ctx, ws, 'a', versionId))).toBe(true)
  expect(rendered).toHaveLength(0)
  expect(sha(video)).toBe(before)
})

it('7: the worker refuses a recipe, snapshot, renderer or original that changed after scheduling', async () => {
  const { d, payloads } = scheduled()
  const versionId = payloads[0].versionId, original = recipeRow(versionId).paramsJson
  const tamper = (patch: Record<string, unknown>) => ctx.db.update(mediaVersions).set({ paramsJson: JSON.stringify({ ...JSON.parse(original), ...patch }) }).where(eq(mediaVersions.id, versionId)).run()
  // Recipe context rewritten (e.g. a newer caption).
  tamper({ layoutContext: { ...JSON.parse(original).layoutContext, caption: 'legenda nova' } })
  await expect(materializeVersion(ctx, ws, 'a', versionId)).rejects.toThrow(/receita congelada/i)
  // Bundled renderer/fonts changed since scheduling: refuse instead of rendering a different result.
  tamper({ rendererVersion: 'scene-0' })
  await expect(materializeVersion(ctx, ws, 'a', versionId)).rejects.toThrow(/receita congelada|renderizador/i)
  ctx.db.update(mediaVersions).set({ paramsJson: original }).where(eq(mediaVersions.id, versionId)).run()
  // Container snapshot rewritten directly in the database.
  const row = ctx.db.select().from(publicationContainers).where(eq(publicationContainers.id, d.container.id)).get()!
  ctx.db.update(publicationContainers).set({ visualSnapshotJson: row.visualSnapshotJson.replace('#ffffff', '#000000') }).where(eq(publicationContainers.id, d.container.id)).run()
  await expect(materializeVersion(ctx, ws, 'a', versionId)).rejects.toThrow(/snapshot visual congelado/i)
  ctx.db.update(publicationContainers).set({ visualSnapshotJson: row.visualSnapshotJson }).where(eq(publicationContainers.id, d.container.id)).run()
  // Original replaced on disk.
  writeFileSync(video, Buffer.concat([readFileSync(video), Buffer.from('x')]))
  await expect(materializeVersion(ctx, ws, 'a', versionId)).rejects.toThrow(/original mudou/i)
  expect(rendered).toHaveLength(0)
  // Items keep the frozen reference to recipe/hash.
  const item = ctx.db.select().from(publicationContainerItems).where(and(eq(publicationContainerItems.workspaceId, ws), eq(publicationContainerItems.assetId, 'a'))).get()!
  expect(JSON.parse(item.effectiveSnapshotJson!)).toMatchObject({ caption: 'legenda A', recipeVersionId: versionId })
})

it('7b: a job payload whose caption or recipe diverges from the frozen item is refused before any API call', async () => {
  const { result, payloads } = scheduled()
  const api = vi.fn()
  const row = ctx.db.select().from(jobs).where(eq(jobs.id, result.jobs[0].id)).get()!
  const leased = (payload: unknown) => ({ ...row, payload, attempts: 1, leaseVersion: 1, attemptId: 'audit' }) as unknown as Parameters<typeof publishInstagram>[1]
  await expect(publishInstagram(ctx, leased({ ...payloads[0], caption: 'legenda nova' }), api)).rejects.toThrow(/intenção congelada/)
  await expect(publishInstagram(ctx, leased({ ...payloads[0], versionId: payloads[1].versionId }), api)).rejects.toThrow(/intenção congelada/)
  expect(api).not.toHaveBeenCalled()
})
