import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { jobs, publicationContainers as containers } from '../db/schema'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { setSetting } from '../repos/settings'
import { enqueue } from '../queue/queue'
import { createContainer, scheduleContainer, readContainer, setContainerControl, cancelContainer } from './publication-containers'
import { connectInstagram } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { recordQuotaReading } from './instagram-quota'
import { readPeakWindows, savePeakWindows, planDistribution, applyDistribution } from './peak-windows'
import { buildHandlers } from '../ipc/handlers'
import { createDispatcher } from '../ipc/dispatcher'
import { releaseAll } from './media-host/registry'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
const all = [0, 1, 2, 3, 4, 5, 6]
const ROADMAP = [{ start: '09:00', end: '12:00', weekdays: all }, { start: '13:00', end: '16:00', weekdays: all }, { start: '17:00', end: '20:00', weekdays: all }, { start: '21:00', end: '00:00', weekdays: all }]
let ctx: Ctx, ws: string, now: Date, root: string, revA: string, revB: string, n = 0
const local = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 16)
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legacy-peak-'))
  now = new Date('2026-10-11T23:00:00.000Z') // 20:00 in São Paulo, the day before
  ctx = { db: memDb(), dataRoot: root, clock: () => now }
  ws = createWorkspace(ctx.db, { name: 'Peak', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (w, k) => decryptSecret(ctx, vault, w, k)
  revA = (await connectInstagram(ctx, vault, ws, 'token-a', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'a' }))).revision
  revB = (await connectInstagram(ctx, vault, ws, 'token-b', vi.fn().mockResolvedValue({ user_id: '222', id: '222', username: 'b' }))).revision
  savePeakWindows(ctx, ws, ROADMAP)
})
afterEach(async () => { await releaseAll(); rmSync(root, { recursive: true, force: true }) })
function asset() { const id = `v-${++n}`, file = join(root, `${id}.mp4`); writeFileSync(file, id); return insertAsset(ctx.db, { id, workspaceId: ws, origin: 'pc', sourceName: `${id}.mp4`, filePath: file, sha256: `sha-${id}`, sizeBytes: 9, durationMs: 2000, width: 720, height: 1280, videoCodec: 'h264', validationJson: '{}', importedAt: now.toISOString() }).id }
function draft(name: string, count = 12, account: '111' | '222' = '111', extra: Record<string, unknown> = {}) {
  return createContainer(ctx, ws, randomUUID(), { name, provider: 'instagram', destinationAccountId: account, accountRevision: account === '111' ? revA : revB, intervalMin: 15, items: Array.from({ length: count }, () => ({ assetId: asset() })), ...extra }).container
}
const apply = (ids: string[], fromDate = '2026-10-12') => {
  const plan = planDistribution(ctx, ws, { containerIds: ids, fromDate })
  return applyDistribution(ctx, ws, { fromDate, items: plan.placements.filter(p => p.placed).map(p => ({ containerId: p.id, expectedRevision: p.revision, start: (p as { start: string }).start })) })
}
const jobTimes = () => ctx.db.select({ id: jobs.id, runAt: jobs.runAt }).from(jobs).all()

describe('peak window configuration', () => {
  it('is stored per workspace, validated by the service and never invented', async () => {
    expect(readPeakWindows(ctx, ws)).toEqual({ windows: ROADMAP, timeZone: 'America/Sao_Paulo' })
    expect(() => savePeakWindows(ctx, ws, [{ start: '09:00', end: '12:00', weekdays: all }, { start: '11:00', end: '13:00', weekdays: [1] }])).toThrow(/se sobrepõem/)
    expect(readPeakWindows(ctx, ws).windows).toEqual(ROADMAP)
    const other = createWorkspace(ctx.db, { name: 'Other', timeZone: 'UTC' }).id
    expect(readPeakWindows(ctx, other)).toEqual({ windows: [], timeZone: 'UTC' })
    setSetting(ctx.db, other, 'scheduler.peakWindows', '{broken')
    expect(readPeakWindows(ctx, other).windows).toEqual([])
    const dispatch = createDispatcher(buildHandlers({ ctx, dialogs: { pickVideos: async () => [], pickImage: async () => null, pickMetricsFile: async () => null }, shell: { openPath: async () => '' }, workerAlive: () => false, version: 't', onJobsChanged: () => {} }))
    expect(await dispatch('scheduler.windows.save', { workspaceId: ws, windows: [{ start: '25:00', end: '01:00', weekdays: all }] })).toMatchObject({ ok: false })
    expect(await dispatch('scheduler.windows.get', { workspaceId: ws })).toMatchObject({ ok: true, data: { windows: ROADMAP } })
  })
})

describe('distribution of Containers', () => {
  it('roadmap example end to end: plan → apply to drafts (no jobs) → schedule each with the PR 05 check; order and intervals intact', () => {
    recordQuotaReading(ctx, ws, '111', { ok: true, usage: 0, total: 50, durationSec: 86400 })
    const ids = ['A', 'B', 'C', 'D'].map(name => draft(name).id)
    const plan = planDistribution(ctx, ws, { containerIds: ids, fromDate: '2026-10-12' })
    expect(plan.placements.map(p => p.placed && `${p.name} ${local(p.start).slice(11)}→${local(p.end).slice(11)}`)).toEqual(['A 09:00→11:45', 'B 13:00→15:45', 'C 17:00→19:45', 'D 21:00→23:45'])
    expect([plan.peakInWindow, plan.quota.limit]).toEqual([48, 50])
    apply(ids)
    expect(jobTimes()).toHaveLength(0)
    for (const id of ids) {
      const c = readContainer(ctx, ws, id).container
      expect(c).toMatchObject({ state: 'draft', timeZone: 'America/Sao_Paulo', intervalMin: 15 })
      const result = scheduleContainer(ctx, ws, id, c.revision)
      const runAts = result.jobs.map(j => Date.parse(j.runAt))
      expect(runAts.every((t, i) => i === 0 || t - runAts[i - 1] === 15 * 60_000)).toBe(true)
      expect(new Date(runAts[0]).toISOString()).toBe(c.plannedStartAt)
    }
    expect(jobTimes()).toHaveLength(48)
  })

  it('existing reservations are never moved; a paused Container still occupies, a cancelled one frees its time; legacy jobs count', async () => {
    const first = draft('Agendado', 4, '111', { plannedStartAt: '2026-10-12T12:00:00.000Z' }) // 09:00 local
    scheduleContainer(ctx, ws, first.id, first.revision)
    setContainerControl(ctx, ws, first.id, first.revision + 1, 'paused')
    enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', payload: { accountId: '111', batchId: 'legacy' }, label: 'Legacy', runAt: new Date('2026-10-12T16:30:00.000Z') }, now) // 13:30 local
    const before = jobTimes()
    const next = draft('Novo', 4)
    const plan = planDistribution(ctx, ws, { containerIds: [next.id], fromDate: '2026-10-12' })
    // 09:00–09:45 is taken (+15 min gap) → 10:00; the legacy point at 13:30 does not interfere.
    expect(plan.placements[0].placed && local(plan.placements[0].start)).toBe('2026-10-12 10:00')
    expect(jobTimes()).toEqual(before)
    await cancelContainer(ctx, ws, first.id, readContainer(ctx, ws, first.id).container.revision)
    const freed = planDistribution(ctx, ws, { containerIds: [next.id], fromDate: '2026-10-12' })
    expect(freed.placements[0].placed && local(freed.placements[0].start)).toBe('2026-10-12 09:00')
  })

  it('accounts are isolated; one destination per distribution; scheduled Containers are never redistributed', () => {
    const b = draft('B conta', 12, '222', { plannedStartAt: '2026-10-12T12:00:00.000Z' })
    scheduleContainer(ctx, ws, b.id, b.revision)
    const a = draft('A conta')
    expect(planDistribution(ctx, ws, { containerIds: [a.id], fromDate: '2026-10-12' }).placements[0]).toMatchObject({ placed: true })
    expect(local((planDistribution(ctx, ws, { containerIds: [a.id], fromDate: '2026-10-12' }).placements[0] as { start: string }).start)).toBe('2026-10-12 09:00')
    expect(() => planDistribution(ctx, ws, { containerIds: [a.id, draft('B2', 1, '222').id], fromDate: '2026-10-12' })).toThrow(/mesmo destino/)
    expect(() => planDistribution(ctx, ws, { containerIds: [b.id], fromDate: '2026-10-12' })).toThrow(/não são movidos/)
    const loose = createContainer(ctx, ws, randomUUID(), { name: 'Sem destino', items: [{ assetId: asset() }] }).container
    expect(() => planDistribution(ctx, ws, { containerIds: [loose.id], fromDate: '2026-10-12' })).toThrow(/defina o destino/)
  })

  it('two previews of the same account cannot both be applied; a changed draft or a duplicate apply is refused atomically', () => {
    const x = draft('X', 12), y = draft('Y', 12)
    const px = planDistribution(ctx, ws, { containerIds: [x.id], fromDate: '2026-10-12' }), py = planDistribution(ctx, ws, { containerIds: [y.id], fromDate: '2026-10-12' })
    expect([px, py].map(p => p.placements[0].placed && local(p.placements[0].start))).toEqual(['2026-10-12 09:00', '2026-10-12 09:00'])
    const items = (p: typeof px) => p.placements.map(v => ({ containerId: v.id, expectedRevision: v.revision, start: (v as { start: string }).start }))
    applyDistribution(ctx, ws, { fromDate: '2026-10-12', items: items(px) })
    expect(() => applyDistribution(ctx, ws, { fromDate: '2026-10-12', items: items(py) })).toThrow(/mudou desde a prévia/)
    expect(() => applyDistribution(ctx, ws, { fromDate: '2026-10-12', items: items(px) })).toThrow(/mudou desde a prévia/)
    expect(readContainer(ctx, ws, y.id).container).toMatchObject({ plannedStartAt: null, revision: y.revision })
    // A fresh preview sees X in the 09:00 window and places Y in the next one.
    apply([y.id])
    expect(local(readContainer(ctx, ws, y.id).container.plannedStartAt!)).toBe('2026-10-12 13:00')
  })

  it('known quota shapes the plan; unknown or stale quota follows PR 05 (no invented capacity)', () => {
    recordQuotaReading(ctx, ws, '111', { ok: true, usage: 0, total: 18, durationSec: 21600 })
    const ids = [draft('Q1').id, draft('Q2').id]
    expect(planDistribution(ctx, ws, { containerIds: ids, fromDate: '2026-10-12' }).placements.map(p => p.placed && local(p.start).slice(11))).toEqual(['09:00', '17:00'])
    now = new Date(now.getTime() + 16 * 60_000)
    const stale = planDistribution(ctx, ws, { containerIds: ids, fromDate: '2026-10-12' })
    expect(stale.placements.map(p => p.placed && local(p.start).slice(11))).toEqual(['09:00', '13:00'])
    expect(stale).toMatchObject({ quota: { status: 'unknown', availableNow: null }, peakInWindow: null })
  })

  it('a Container with a longer interval is not interleaved with another one inside its span', () => {
    const slow = draft('Lento', 3, '111', { plannedStartAt: '2026-10-12T12:00:00.000Z', intervalMin: 60 }) // 09:00, 10:00, 11:00
    scheduleContainer(ctx, ws, slow.id, slow.revision)
    const quick = draft('Rápido', 2)
    // Not at 09:15 or 10:15 between its items: only after the whole span (11:00) plus its own 15 min.
    expect(local((planDistribution(ctx, ws, { containerIds: [quick.id], fromDate: '2026-10-12' }).placements[0] as { start: string }).start)).toBe('2026-10-12 11:15')
  })

  it('without windows the planner explains what to do instead of guessing times', () => {
    savePeakWindows(ctx, ws, [])
    expect(() => planDistribution(ctx, ws, { containerIds: [draft('Z', 1).id], fromDate: '2026-10-12' })).toThrow(/Configure as janelas de pico/)
    expect(ctx.db.select().from(containers).where(eq(containers.name, 'Z')).get()?.plannedStartAt).toBeNull()
  })
})

it('retries and checkpoints: a failed job frees its time, a retried one occupies it again; plan/apply never touch checkpoints', () => {
  const c = draft('Falhou', 2, '111', { plannedStartAt: '2026-10-12T12:00:00.000Z' })
  const [job] = scheduleContainer(ctx, ws, c.id, c.revision).jobs
  const checkpoint = JSON.stringify({ containerId: '987', stage: 'PROVIDER_PROCESSING' })
  ctx.db.update(jobs).set({ state: 'failed', resultJson: checkpoint }).where(eq(jobs.id, job.id)).run()
  const other = jobTimes().find(j => j.id !== job.id)!
  ctx.db.update(jobs).set({ state: 'failed' }).where(eq(jobs.id, other.id)).run()
  const next = draft('Depois', 2)
  expect(local((planDistribution(ctx, ws, { containerIds: [next.id], fromDate: '2026-10-12' }).placements[0] as { start: string }).start)).toBe('2026-10-12 09:00')
  ctx.db.update(jobs).set({ state: 'queued' }).where(eq(jobs.id, job.id)).run()
  apply([next.id])
  expect(local(readContainer(ctx, ws, next.id).container.plannedStartAt!)).toBe('2026-10-12 09:15')
  expect(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()).toMatchObject({ state: 'queued', resultJson: checkpoint, runAt: '2026-10-12T12:00:00.000Z' })
})
