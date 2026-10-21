import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { jobs, mediaVersions, publicationContainerAdjustments as adjustments, publicationContainerItems as items } from '../db/schema'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { leaseNext } from '../queue/queue'
import { createContainer, scheduleContainer, readContainer, setContainerControl, cancelContainer } from './publication-containers'
import { connectInstagram } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { recordQuotaReading } from './instagram-quota'
import { deferPublicationAccount } from './instagram-publication-limit'
import { savePeakWindows } from './peak-windows'
import { readContainerWindow, applyContainerAdjustment, previewContainerDrag, applyContainerDrag } from './container-window'
import { publicationContainers } from '../db/schema'
import { buildHandlers } from '../ipc/handlers'
import { createDispatcher } from '../ipc/dispatcher'
import { releaseAll } from './media-host/registry'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
let ctx: Ctx, ws: string, now: Date, root: string, rev: string, n = 0
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legacy-window-'))
  now = new Date('2026-10-12T15:00:00.000Z') // 12:00 São Paulo
  ctx = { db: memDb(), dataRoot: root, clock: () => now }
  ws = createWorkspace(ctx.db, { name: 'Window', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (w, k) => decryptSecret(ctx, vault, w, k)
  rev = (await connectInstagram(ctx, vault, ws, 'token', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'a' }))).revision
})
afterEach(async () => { await releaseAll(); rmSync(root, { recursive: true, force: true }) })
function asset() { const id = `v-${++n}`, file = join(root, `${id}.mp4`); writeFileSync(file, id); return insertAsset(ctx.db, { id, workspaceId: ws, origin: 'pc', sourceName: `${id}.mp4`, filePath: file, sha256: `sha-${id}`, sizeBytes: 9, durationMs: 2000, width: 720, height: 1280, videoCodec: 'h264', validationJson: '{}', importedAt: now.toISOString() }).id }
/** 16:00 UTC = 13:00 local, like the roadmap example. */
function scheduled(count = 12, intervalMin = 15, start = '2026-10-12T16:00:00.000Z') {
  const d = createContainer(ctx, ws, randomUUID(), { name: 'Janela', provider: 'instagram', destinationAccountId: '111', accountRevision: rev, plannedStartAt: start, intervalMin, captionBase: 'base', items: Array.from({ length: count }, () => ({ assetId: asset() })) })
  return { id: d.container.id, jobs: scheduleContainer(ctx, ws, d.container.id, d.container.revision).jobs }
}
const job = (id: string) => ctx.db.select().from(jobs).where(eq(jobs.id, id)).get()!
const confirm = (jobId: string) => { ctx.db.update(jobs).set({ state: 'done' }).where(eq(jobs.id, jobId)).run(); ctx.db.run(`insert into publication_history(job_id,workspace_id,account_id,username,provenance_json,published_at) values ('${jobId}','${ws}','111','a','{}','${now.toISOString()}')`) }
/** The real queue deferral: the account hit the limit; the whole pending sequence shifts by the same offset. */
function quotaDefer(minutes: number) {
  const leased = leaseNext(ctx.db, now, 60_000)!
  deferPublicationAccount(ctx, leased, undefined, { resumeAt: new Date(Date.parse(leased.runAt) + minutes * 60_000).toISOString(), checkedAt: now.toISOString() })
}

describe('container window', () => {
  it('on time: estimate equals the planned end; the reserved DTO fields are filled through IPC', async () => {
    const c = scheduled()
    expect(readContainerWindow(ctx, ws, c.id).window).toMatchObject({ status: 'on_time', estimatedEndAt: '2026-10-12T18:45:00.000Z', delayMin: 0, published: 0, remaining: 12 })
    const dispatch = createDispatcher(buildHandlers({ ctx, dialogs: { pickVideos: async () => [], pickImage: async () => null, pickMetricsFile: async () => null }, shell: { openPath: async () => '' }, workerAlive: () => false, version: 't', onJobsChanged: () => {} }))
    const got = await dispatch('containers.get', { workspaceId: ws, containerId: c.id })
    expect(got.ok && (got.data as import('@shared/publication-containers').ContainerDetail).container).toMatchObject({ estimatedEndAt: '2026-10-12T18:45:00.000Z', delayMin: 0, quotaTotal: null, quotaAvailable: null })
    recordQuotaReading(ctx, ws, '111', { ok: true, usage: 10, total: 40, durationSec: 86400 })
    const listed = await dispatch('containers.query', { workspaceId: ws, states: ['scheduled', 'in_progress', 'paused'] })
    expect(listed.ok && (listed.data as import('@shared/publication-containers').ContainerPage).items[0]).toMatchObject({ id: c.id, quotaTotal: 40, quotaAvailable: 30 })
    expect(await dispatch('containers.window.get', { workspaceId: createWorkspace(ctx.db, { name: 'X', timeZone: 'UTC' }).id, containerId: c.id })).toMatchObject({ ok: false })
  })

  it('roadmap example: 8/12 published, a quota deferral makes the Container exceed its window; keep records the choice and moves nothing', () => {
    const c = scheduled()
    now = new Date('2026-10-12T16:00:00.000Z')
    for (const j of c.jobs.slice(0, 8)) confirm(j.id)
    now = new Date('2026-10-12T18:00:00.000Z') // item 9 is due (15:00 local)
    // With a valid 1 h reading the deferral uses Meta's window, not the 24 h fallback.
    recordQuotaReading(ctx, ws, '111', { ok: true, usage: 0, total: 50, durationSec: 3600 })
    quotaDefer(22)
    const view = readContainerWindow(ctx, ws, c.id)
    // The queue's policy without local history in the window: try again in 1 h → the window is exceeded by 60 min.
    expect(view.window).toMatchObject({ status: 'late', published: 8, remaining: 4, delayMin: 60, estimatedEndAt: '2026-10-12T19:45:00.000Z' })
    expect(view.proposals.proposals.map(p => p.kind)).toEqual(['keep'])
    expect(view.proposals.unavailable.map(u => u.kind)).toEqual(['reduce', 'move'])
    const before = c.jobs.slice(8).map(j => job(j.id).runAt)
    const after = applyContainerAdjustment(ctx, ws, c.id, { expectedRevision: view.revision, kind: 'keep', slots: [] })
    expect(c.jobs.slice(8).map(j => job(j.id).runAt)).toEqual(before)
    expect(after.adjustments).toMatchObject([{ kind: 'keep', before: { delayMin: 60, intervalMin: 15 }, after: { intervalMin: 15 } }])
  })

  it('reduce: only fresh items move; started, confirmed and checkpointed ones are untouched; plan, history and quota re-check are atomic', () => {
    const c = scheduled(6, 30) // 13:00 → 15:30 local
    const recipesBefore = ctx.db.select().from(mediaVersions).all()
    now = new Date('2026-10-12T16:00:00.000Z'); confirm(c.jobs[0].id)
    now = new Date('2026-10-12T16:30:00.000Z') // item 2 is due
    quotaDefer(40)
    const inflight = c.jobs[1].id
    ctx.db.update(jobs).set({ resultJson: JSON.stringify({ containerId: '987', stage: 'PROVIDER_PROCESSING' }) }).where(eq(jobs.id, inflight)).run()
    const view = readContainerWindow(ctx, ws, c.id)
    expect(view.window.status).toBe('late')
    const reduce = view.proposals.proposals.find(p => p.kind === 'reduce')!
    expect(reduce.kind === 'reduce' && reduce.slots.map(s => s.jobId)).toEqual(c.jobs.slice(2).map(j => j.id))
    if (reduce.kind !== 'reduce') throw Error('reduce')
    const payloads = c.jobs.map(j => job(j.id).payloadJson), inflightBefore = job(inflight)
    expect(() => applyContainerAdjustment(ctx, ws, c.id, { expectedRevision: view.revision - 1, kind: 'reduce', slots: reduce.slots })).toThrow(/mudou/)
    expect(() => applyContainerAdjustment(ctx, ws, c.id, { expectedRevision: view.revision, kind: 'reduce', slots: reduce.slots.map(s => ({ ...s, at: '2026-10-12T20:00:00.000Z' })) })).toThrow(/mudaram desde a prévia/)
    const result = applyContainerAdjustment(ctx, ws, c.id, { expectedRevision: view.revision, kind: 'reduce', slots: reduce.slots })
    expect(reduce.slots.map(s => job(s.jobId).runAt)).toEqual(reduce.slots.map(s => s.at))
    expect(job(inflight)).toEqual(inflightBefore)
    expect(c.jobs.map(j => job(j.id).payloadJson)).toEqual(payloads)
    expect(ctx.db.select().from(mediaVersions).all()).toEqual(recipesBefore)
    expect(ctx.db.select().from(items).where(and(eq(items.workspaceId, ws), eq(items.jobId, reduce.slots[0].jobId))).get()!.plannedPublishAt).toBe(reduce.slots[0].at)
    expect(readContainer(ctx, ws, c.id).container).toMatchObject({ intervalMin: reduce.intervalMin, revision: view.revision + 1 })
    expect(result.window.delayMin).toBe(reduce.delayMin)
    expect(ctx.db.select().from(adjustments).all()).toHaveLength(1)
  })

  it('move: remaining items go to the next free peak window with the same interval; other Containers never move', () => {
    savePeakWindows(ctx, ws, [{ start: '18:00', end: '21:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }])
    const c = scheduled(4)
    now = new Date('2026-10-12T16:05:00.000Z'); quotaDefer(30)
    // Scheduled after the deferral, so the account-wide shift does not apply to it.
    const other = scheduled(2, 15, '2026-10-12T21:00:00.000Z') // 18:00–18:15 local
    const otherBefore = other.jobs.map(j => job(j.id).runAt)
    const view = readContainerWindow(ctx, ws, c.id)
    const move = view.proposals.proposals.find(p => p.kind === 'move')!
    if (move.kind !== 'move') throw Error('move')
    // 18:00 is taken by the other Container until 18:15 (+15 min gap) → 18:30 local.
    expect(move.startAt).toBe('2026-10-12T21:30:00.000Z')
    expect(move.slots.map(s => s.at)).toEqual(['21:30', '21:45', '22:00', '22:15'].map(t => `2026-10-12T${t}:00.000Z`))
    applyContainerAdjustment(ctx, ws, c.id, { expectedRevision: view.revision, kind: 'move', slots: move.slots })
    expect(other.jobs.map(j => job(j.id).runAt)).toEqual(otherBefore)
    expect(readContainer(ctx, ws, c.id).container).toMatchObject({ plannedStartAt: '2026-10-12T16:00:00.000Z', plannedEndAt: '2026-10-12T22:15:00.000Z', intervalMin: 15 })
    expect(readContainerWindow(ctx, ws, c.id).window).toMatchObject({ status: 'on_time', delayMin: 0 })
  })

  it('paused or cancelled Containers have no estimate nor proposals, and adjustments are refused', async () => {
    const c = scheduled(4)
    now = new Date('2026-10-12T16:05:00.000Z'); quotaDefer(30)
    const late = readContainerWindow(ctx, ws, c.id)
    setContainerControl(ctx, ws, c.id, late.revision, 'paused')
    const paused = readContainerWindow(ctx, ws, c.id)
    expect(paused).toMatchObject({ window: { status: 'paused', estimatedEndAt: null }, proposals: { proposals: [] } })
    expect(() => applyContainerAdjustment(ctx, ws, c.id, { expectedRevision: paused.revision, kind: 'keep', slots: [] })).toThrow(/ativos/)
    await cancelContainer(ctx, ws, c.id, paused.revision)
    expect(readContainerWindow(ctx, ws, c.id).window.status).toBe('cancelled')
  })

  it('a quota reading that leaves no room makes the estimate later and is re-checked when applying', () => {
    const c = scheduled(3, 30)
    now = new Date('2026-10-12T16:10:00.000Z'); quotaDefer(20)
    recordQuotaReading(ctx, ws, '111', { ok: true, usage: 5, total: 5, durationSec: 7200 })
    const view = readContainerWindow(ctx, ws, c.id)
    expect(view.window).toMatchObject({ quotaConsidered: true, status: 'late' })
    // Unattributed usage at the reading (16:10) frees at 18:10; nothing can be placed before it.
    expect(Date.parse(view.window.estimate[0].at)).toBeGreaterThanOrEqual(Date.parse('2026-10-12T18:10:00.000Z'))
    expect(view.quota).toMatchObject({ total: 5, available: 0, freshness: 'fresh' })
  })
})

describe('drag & drop on the Agenda (PR 10)', () => {
  it('moves only fresh items by the dropped delta, shifts the planned window and records it; nothing changes before confirming', async () => {
    const c = scheduled(4)
    const other = scheduled(2, 15, '2026-10-13T16:00:00.000Z')
    now = new Date('2026-10-12T16:20:00.000Z')
    confirm(c.jobs[0].id)
    ctx.db.update(jobs).set({ resultJson: JSON.stringify({ containerId: 'remote-1' }) }).where(eq(jobs.id, c.jobs[1].id)).run()
    const target = '2026-10-12T19:00:00.000Z' // +3 h
    const before = c.jobs.map(j => job(j.id).runAt), otherBefore = other.jobs.map(j => job(j.id).runAt)
    const p = previewContainerDrag(ctx, ws, c.id, target)
    expect(p).toMatchObject({ blocked: null, deltaMin: 180, unchanged: { published: 1, inFlight: 1, failed: 0 }, after: { startAt: target, endAt: '2026-10-12T19:45:00.000Z' } })
    expect(p.slots.map(s => [s.jobId, s.at])).toEqual([[c.jobs[2].id, '2026-10-12T19:30:00.000Z'], [c.jobs[3].id, '2026-10-12T19:45:00.000Z']])
    expect(c.jobs.map(j => job(j.id).runAt)).toEqual(before)
    const view = applyContainerDrag(ctx, ws, c.id, { expectedRevision: p.revision, startAt: target, slots: p.slots })
    expect(c.jobs.map(j => job(j.id).runAt)).toEqual([before[0], before[1], '2026-10-12T19:30:00.000Z', '2026-10-12T19:45:00.000Z'])
    expect(ctx.db.select({ at: items.plannedPublishAt }).from(items).where(eq(items.jobId, c.jobs[3].id)).get()!.at).toBe('2026-10-12T19:45:00.000Z')
    expect(other.jobs.map(j => job(j.id).runAt)).toEqual(otherBefore)
    const row = ctx.db.select().from(publicationContainers).where(eq(publicationContainers.id, c.id)).get()!
    expect(row).toMatchObject({ plannedStartAt: target, plannedEndAt: '2026-10-12T19:45:00.000Z', revision: p.revision + 1 })
    expect(view.adjustments[0]).toMatchObject({ kind: 'drag', before: { plannedStartAt: '2026-10-12T16:00:00.000Z' }, after: { plannedStartAt: target } })
    // The same confirmation cannot be replayed against the new revision.
    expect(() => applyContainerDrag(ctx, ws, c.id, { expectedRevision: p.revision, startAt: target, slots: p.slots })).toThrow(/mudou/)
  })

  it('refuses stale previews, started items, paused Containers and other workspaces', async () => {
    const c = scheduled(3)
    const target = '2026-10-12T20:00:00.000Z'
    const p = previewContainerDrag(ctx, ws, c.id, target)
    expect(() => applyContainerDrag(ctx, ws, c.id, { expectedRevision: p.revision, startAt: target, slots: p.slots.map(s => ({ ...s, at: '2026-10-12T21:00:00.000Z' })) })).toThrow(/mudaram/)
    ctx.db.update(jobs).set({ resultJson: JSON.stringify({ creating: true }) }).where(eq(jobs.id, c.jobs[0].id)).run()
    // A checkpoint written after the preview: the recomputed preview no longer matches, nothing moves.
    expect(() => applyContainerDrag(ctx, ws, c.id, { expectedRevision: p.revision, startAt: target, slots: p.slots })).toThrow()
    expect(job(c.jobs[1].id).runAt).toBe('2026-10-12T16:15:00.000Z')
    const paused = scheduled(2, 15, '2026-10-14T16:00:00.000Z')
    const rev2 = readContainer(ctx, ws, paused.id).container.revision
    setContainerControl(ctx, ws, paused.id, rev2, 'paused')
    expect(previewContainerDrag(ctx, ws, paused.id, target).blocked).toMatch(/Retome/)
    const dispatch = createDispatcher(buildHandlers({ ctx, dialogs: { pickVideos: async () => [], pickImage: async () => null, pickMetricsFile: async () => null }, shell: { openPath: async () => '' }, workerAlive: () => false, version: 't', onJobsChanged: () => {} }))
    expect(await dispatch('containers.drag.preview', { workspaceId: createWorkspace(ctx.db, { name: 'Y', timeZone: 'UTC' }).id, containerId: c.id, startAt: target })).toMatchObject({ ok: false })
    expect(await dispatch('containers.drag.preview', { workspaceId: ws, containerId: c.id, startAt: 'amanhã' })).toMatchObject({ ok: false })
  })
})
