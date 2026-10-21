import { EventEmitter } from 'node:events'
import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Ctx } from '../context'
import { memDb, MIGRATIONS_DIR } from '../test-utils'
import { openDb } from '../db/client'
import { jobs, providerQuotaSnapshots, providerLimits, publicationHistory, mediaVersions } from '../db/schema'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { createContainer, scheduleContainer } from './publication-containers'
import * as instagram from './instagram-publishing'
import { connectInstagram, refreshInstagramQuota, InstagramApiError, type PublishDeps } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { accountQuota, recordQuotaReading, readQuotaSnapshot, parseQuotaResponse } from './instagram-quota'
import { enqueue, leaseNext } from '../queue/queue'
import { processNext } from '../worker/handlers'
import { releaseAll } from './media-host/registry'
import { buildHandlers } from '../ipc/handlers'
import { createDispatcher } from '../ipc/dispatcher'

/** Real `instagramJson` transport; only the socket is simulated. Each call consumes one queued answer. */
const http = vi.hoisted(() => ({ answers: [] as ({ status: number; body: string; headers?: Record<string, string> } | 'network')[], calls: [] as { url: string; method: string; auth?: string }[] }))
vi.mock('../diagnostics', async importOriginal => {
  const original = await importOriginal<typeof import('../diagnostics')>()
  return { ...original, diagnosticRequest: (url: string, opts: { method: string; headers: Record<string, string> }, callback: (res: unknown) => void) => {
    http.calls.push({ url, method: opts.method, auth: opts.headers.Authorization })
    const req = new EventEmitter() as EventEmitter & { end(): void }
    req.end = () => queueMicrotask(() => {
      const answer = http.answers.shift()
      if (!answer || answer === 'network') { req.emit('error', new Error('ECONNRESET')); return }
      const res = Object.assign(new EventEmitter(), { statusCode: answer.status, headers: answer.headers ?? {}, setEncoding() {} })
      callback(res); res.emit('data', answer.body); res.emit('end')
    })
    return req
  } }
})
const ok = (usage: number, total: number, duration: number) => ({ status: 200, body: JSON.stringify({ data: [{ quota_usage: usage, config: { quota_total: total, quota_duration: duration } }] }) })
const metaError = (status: number, code: number, headers?: Record<string, string>) => ({ status, body: JSON.stringify({ error: { code, type: 'OAuthException', message: 'synthetic' } }), headers })

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
let ctx: Ctx, ws: string, now: Date, root: string, revA: string, revB: string, deps: PublishDeps
beforeEach(async () => {
  http.answers = []; http.calls = []
  root = mkdtempSync(join(tmpdir(), 'legacy-quota-'))
  now = new Date('2026-10-10T12:00:00.000Z')
  ctx = { db: memDb(), dataRoot: root, clock: () => now }
  ws = createWorkspace(ctx.db, { name: 'Quota', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (workspace, key) => decryptSecret(ctx, vault, workspace, key)
  revA = (await connectInstagram(ctx, vault, ws, 'token-a-secret', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'a' }))).revision
  revB = (await connectInstagram(ctx, vault, ws, 'token-b-secret', vi.fn().mockResolvedValue({ user_id: '222', id: '222', username: 'b' }))).revision
  deps = { host: { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'https://synthetic.invalid/v.mp4', release: vi.fn().mockResolvedValue(undefined) }) }, prepare: vi.fn().mockImplementation(async path => ({ path, cleanup: vi.fn() })) }
})
afterEach(async () => { vi.restoreAllMocks(); await releaseAll(); rmSync(root, { recursive: true, force: true }) })
let assets = 0
function asset(c = ctx, w = ws) {
  const id = `asset-${++assets}`, file = join(root, `${id}.mp4`); writeFileSync(file, id)
  return insertAsset(c.db, { id, workspaceId: w, origin: 'pc', sourceName: `${id}.mp4`, filePath: file, sha256: `sha-${id}`, sizeBytes: 9, durationMs: 2000, width: 720, height: 1280, videoCodec: 'h264', validationJson: '{}', importedAt: now.toISOString() }).id
}
function container(count: number, start: string, account: '111' | '222' = '111', interval = 15, c = ctx) {
  return createContainer(c, ws, randomUUID(), { name: `C ${start}`, provider: 'instagram', destinationAccountId: account, accountRevision: account === '111' ? revA : revB,
    plannedStartAt: start, intervalMin: interval, items: Array.from({ length: count }, () => ({ assetId: asset(c) })) })
}
const schedule = (d: ReturnType<typeof container>, c = ctx) => scheduleContainer(c, ws, d.container.id, d.container.revision)
const reading = (usage: number, total: number, durationSec: number, account = '111', c = ctx) => recordQuotaReading(c, ws, account, { ok: true, usage, total, durationSec })
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
const jobRow = (id: string) => ctx.db.select().from(jobs).where(eq(jobs.id, id)).get()!

describe('snapshot from the official endpoint', () => {
  it('GETs content_publishing_limit on the existing API host/version, with the token only in the header, and stores runtime values', async () => {
    http.answers.push(ok(7, 25, 7200))
    const view = await refreshInstagramQuota(ctx, ws, '111')
    expect(http.calls).toEqual([{ url: 'https://graph.instagram.com/v25.0/111/content_publishing_limit?fields=quota_usage,config', method: 'GET', auth: 'Bearer token-a-secret' }])
    expect(view).toMatchObject({ usage: 7, total: 25, durationSec: 7200, fetchedAt: now.toISOString(), lastStatus: 'ok', freshness: 'fresh', source: 'instagram.content_publishing_limit' })
    const row = ctx.db.select().from(providerQuotaSnapshots).all()
    expect(JSON.stringify(row)).not.toMatch(/token-a-secret|protected:/)
    expect(accountQuota(ctx, ws, '111')).toMatchObject({ status: 'known', limit: 25, windowSec: 7200, availableNow: 18 })
  })

  it('incomplete, mistyped and unparseable answers keep the last valid reading and say why', async () => {
    http.answers.push(ok(1, 10, 3600))
    await refreshInstagramQuota(ctx, ws, '111')
    now = new Date(now.getTime() + 60_000)
    for (const body of [{ data: [{ quota_usage: 3 }] }, { data: [{ quota_usage: 3, config: { quota_total: '50', quota_duration: 86400 } }] }, { data: [] }]) {
      http.answers.push({ status: 200, body: JSON.stringify(body) })
      expect(await refreshInstagramQuota(ctx, ws, '111')).toMatchObject({ lastStatus: 'error', errorKind: 'invalid_response', usage: 1, total: 10, fetchedAt: '2026-10-10T12:00:00.000Z' })
    }
    http.answers.push({ status: 200, body: '<html>' })
    expect(await refreshInstagramQuota(ctx, ws, '111')).toMatchObject({ errorKind: 'invalid_response', usage: 1 })
    expect(parseQuotaResponse({ quota_usage: 0, config: { quota_total: 3, quota_duration: 60 } })).toEqual({ usage: 0, total: 3, durationSec: 60 })
  })

  it('network failure, permission denied and rate limit are explicit; rate limit cools the account down and recovery clears the error', async () => {
    http.answers.push('network')
    expect(await refreshInstagramQuota(ctx, ws, '111')).toMatchObject({ lastStatus: 'error', errorKind: 'network', fetchedAt: null, freshness: 'missing' })
    http.answers.push(metaError(400, 190))
    expect(await refreshInstagramQuota(ctx, ws, '111')).toMatchObject({ errorKind: 'permission' })
    http.answers.push(metaError(429, 0, { 'retry-after': '120' }))
    expect(await refreshInstagramQuota(ctx, ws, '111')).toMatchObject({ errorKind: 'rate_limited' })
    const calls = http.calls.length
    expect(await refreshInstagramQuota(ctx, ws, '111')).toMatchObject({ errorKind: 'rate_limited' })
    expect(http.calls).toHaveLength(calls)
    // An account-scoped throttle on A does not affect B.
    http.answers.push(ok(0, 5, 3600))
    expect(await refreshInstagramQuota(ctx, ws, '222')).toMatchObject({ lastStatus: 'ok' })
    // App-wide throttling (code 4) pauses quota reads for every account.
    http.answers.push(metaError(400, 4))
    now = new Date(now.getTime() + 60_000)
    expect(await refreshInstagramQuota(ctx, ws, '222')).toMatchObject({ errorKind: 'rate_limited' })
    const appWide = http.calls.length
    expect(await refreshInstagramQuota(ctx, ws, '222')).toMatchObject({ errorKind: 'rate_limited', usage: 0 })
    expect(http.calls).toHaveLength(appWide)
    now = new Date(now.getTime() + 10 * 60_000)
    http.answers.push(ok(2, 5, 3600))
    expect(await refreshInstagramQuota(ctx, ws, '111')).toMatchObject({ lastStatus: 'ok', errorKind: null, usage: 2 })
    expect(ctx.db.select().from(providerLimits).where(and(eq(providerLimits.operation, 'quota_status'), eq(providerLimits.accountId, '111'))).all()).toHaveLength(0)
    expect(accountQuota(ctx, ws, '111').status).toBe('known')
  })

  it('a reading older than the freshness bound is shown as stale, never used to estimate capacity', async () => {
    reading(1, 5, 3600)
    now = new Date(now.getTime() + 16 * 60_000)
    expect(readQuotaSnapshot(ctx.db, ws, '111', now)?.freshness).toBe('stale')
    expect(accountQuota(ctx, ws, '111', { candidates: [at(10)] })).toMatchObject({ status: 'unknown', availableNow: null, limit: 5, slots: [] })
  })
})

describe('atomic reservations at scheduling', () => {
  it('rejects a Container that does not fit and rolls back every job, recipe and item; a smaller one fits', () => {
    reading(1, 3, 3600)
    // The usage reported at T0 occupies the window until T0 + 1 h; at +45 min the window holds T0 plus three items: one too many.
    const big = container(4, at(15))
    expect(() => schedule(big)).toThrow(/não comporta 1 publicação/)
    expect(ctx.db.select().from(jobs).all()).toHaveLength(0)
    expect(ctx.db.select().from(mediaVersions).all()).toHaveLength(0)
    expect(schedule(container(2, at(30))).jobs).toHaveLength(2)
    expect(accountQuota(ctx, ws, '111').breakdown).toMatchObject({ official: 1, pending: 2 })
  })

  it('two Containers of the same account cannot reserve the same capacity, even through separate connections', async () => {
    const file = join(root, 'shared.sqlite'), a = openDb(file, MIGRATIONS_DIR), b = openDb(file, MIGRATIONS_DIR)
    try {
      const ca: Ctx = { ...ctx, db: a.db }, cb: Ctx = { ...ctx, db: b.db }
      ws = createWorkspace(a.db, { name: 'Shared', timeZone: 'UTC' }).id
      ca.secret = cb.secret = (w, k) => decryptSecret(ca, vault, w, k)
      revA = (await connectInstagram(ca, vault, ws, 'token-a-secret', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'a' }))).revision
      reading(0, 2, 3600, '111', ca)
      // Both drafts were prepared while capacity looked free; the schedule transaction decides.
      const first = container(2, at(30), '111', 15, ca), second = container(1, at(70), '111', 15, cb), third = container(1, at(40), '111', 15, cb)
      expect(schedule(first, ca).jobs).toHaveLength(2)
      expect(() => schedule(second, cb)).toThrow(/não comporta/)
      expect(() => schedule(third, cb)).toThrow(/levaria 1 publicação\(ões\) já agendada/)
      expect(b.db.select().from(jobs).all()).toHaveLength(2)
    } finally { a.close(); b.close() }
  })

  it('a new Container cannot push an already scheduled one over the limit; replay of a scheduled one stays idempotent', () => {
    reading(0, 2, 3600)
    const later = container(1, at(50)), laterJobs = schedule(later).jobs
    const earlier = container(2, at(10), '111', 15)
    expect(() => schedule(earlier)).toThrow(/levaria 1 publicação\(ões\) já agendada/)
    reading(2, 2, 3600)
    expect(schedule(later).jobs.map(j => j.id)).toEqual(laterJobs.map(j => j.id))
  })

  it('accounts are isolated: B exhausted never blocks A, and A never redirects to B', () => {
    reading(5, 5, 3600, '222'); reading(0, 5, 3600, '111')
    const a = schedule(container(3, at(10)))
    expect(a.jobs.every(j => JSON.parse(jobRow(j.id).payloadJson).accountId === '111')).toBe(true)
    expect(() => schedule(container(1, at(10), '222'))).toThrow(/não comporta/)
    expect(accountQuota(ctx, ws, '222')).toMatchObject({ availableNow: 0, breakdown: { pending: 0 } })
  })

  it('legacy jobs and local confirmations count without double counting; unknown quota never blocks', () => {
    enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', payload: { accountId: '111', batchId: 'legacy' }, label: 'Legacy', runAt: new Date(at(5)) }, now)
    // Published 10 min before the reading → inside quota_usage; published after it → added locally.
    ctx.db.insert(publicationHistory).values([{ jobId: 'h1', workspaceId: ws, accountId: '111', username: 'a', provenanceJson: '{}', publishedAt: at(-10) },
      { jobId: 'h2', workspaceId: ws, accountId: '111', username: 'a', provenanceJson: '{}', publishedAt: at(1) }]).run()
    reading(1, 4, 3600)
    now = new Date(now.getTime() + 2 * 60_000)
    expect(accountQuota(ctx, ws, '111')).toMatchObject({ availableNow: 2, breakdown: { official: 1, confirmedAfterSnapshot: 1, pending: 1 } })
    expect(() => schedule(container(2, at(20)))).toThrow(/não comporta 1/)
    ctx.db.delete(providerQuotaSnapshots).run()
    expect(schedule(container(5, at(20))).jobs).toHaveLength(5)
    expect(accountQuota(ctx, ws, '111').status).toBe('unknown')
  })

  it('IPC: projection with candidate slots, scoped to the workspace account, without credentials', async () => {
    reading(3, 4, 3600)
    const dispatch = createDispatcher(buildHandlers({ ctx, dialogs: { pickVideos: async () => [], pickImage: async () => null, pickMetricsFile: async () => null }, shell: { openPath: async () => '' }, workerAlive: () => false, version: 'test', onJobsChanged: () => {} }))
    const result = await dispatch('quota.get', { workspaceId: ws, accountId: '111', slots: [at(10), at(20)] })
    expect(result.ok && result.data).toMatchObject({ status: 'known', overLimit: 1, breakdown: { candidates: 2 } })
    expect(JSON.stringify(result)).not.toMatch(/token-a-secret/)
    expect(await dispatch('quota.get', { workspaceId: ws, accountId: '999' })).toMatchObject({ ok: false })
    const other = createWorkspace(ctx.db, { name: 'Other', timeZone: 'UTC' }).id
    expect(await dispatch('quota.get', { workspaceId: other, accountId: '111' })).toMatchObject({ ok: false })
  })
})

describe('queue integration', () => {
  const real = instagram.publishInstagram
  function worker(api: ReturnType<typeof vi.fn>) {
    return vi.spyOn(instagram, 'publishInstagram').mockImplementation((c, job) => real(c, job, api as never, deps))
  }

  it('fresh reading without room: defers before any POST, keeps attempts, checkpoint, order and interval; account B proceeds', async () => {
    const aJobs = schedule(container(3, at(30), '111', 15)).jobs
    const bJobs = schedule(container(1, at(30), '222')).jobs
    ctx.db.update(jobs).set({ resultJson: JSON.stringify({ stage: 'QUEUED_BY_TEST' }) }).where(eq(jobs.id, aJobs[0].id)).run()
    // The account published 4 times locally 20 min ago; Meta reports the 4 of 4 in a 1 h window.
    ctx.db.insert(publicationHistory).values([1, 2, 3, 4].map(n => ({ jobId: `h${n}`, workspaceId: ws, accountId: '111', username: 'a', provenanceJson: '{}', publishedAt: new Date(now.getTime() + 10 * 60_000 - n * 1000).toISOString() }))).run()
    now = new Date(now.getTime() + 30 * 60_000)
    reading(4, 4, 3600)
    const api = vi.fn(), spy = worker(api)
    try {
      expect(await processNext(ctx, () => {})).toBe(true)
      expect(api).not.toHaveBeenCalled()
      const first = jobRow(aJobs[0].id), checkpoint = JSON.parse(first.resultJson!)
      expect(first).toMatchObject({ state: 'queued', attempts: 0 })
      expect(checkpoint).toMatchObject({ stage: 'QUEUED_BY_TEST', publicationLimit: { cause: 'quota_snapshot', checkedAt: now.toISOString(), usage: 4, total: 4, windowSec: 3600 } })
      expect(first.lastError).toMatch(/consulta de .*4\/4 em 1 h/)
      // Earliest local publication expires at 10:59:56 + 60 min window → plus the one-minute margin.
      const resume = Date.parse(first.runAt)
      expect(resume).toBe(Date.parse('2026-10-10T12:10:00.000Z') - 4000 + 3_600_000 + 60_000)
      const runAts = aJobs.map(j => Date.parse(jobRow(j.id).runAt))
      expect([runAts[1] - runAts[0], runAts[2] - runAts[1]]).toEqual([15 * 60_000, 15 * 60_000])
      api.mockResolvedValueOnce({ id: '900' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '901' })
      expect(await processNext(ctx, () => {})).toBe(true)
      expect(jobRow(bJobs[0].id).state).not.toBe('failed')
      expect(String(api.mock.calls[0][0])).toBe('222/media')
    } finally { spy.mockRestore() }
  })

  it('Meta refusal: reads the official window right away, defers with it, never repeats the POST blindly and keeps attempts', async () => {
    const aJobs = schedule(container(2, at(5))).jobs, published = at(-100)
    ctx.db.insert(publicationHistory).values({ jobId: 'old', workspaceId: ws, accountId: '111', username: 'a', provenanceJson: '{}', publishedAt: published }).run()
    now = new Date(now.getTime() + 5 * 60_000)
    const api = vi.fn().mockImplementation(async (path: string, _token: string, body?: unknown) => {
      if (path.includes('content_publishing_limit')) return { data: [{ quota_usage: 9, config: { quota_total: 9, quota_duration: 7200 } }] }
      if (body) throw new InstagramApiError(400, 9, undefined, 2207042)
      throw new Error('unexpected GET')
    })
    const spy = worker(api)
    try {
      expect(await processNext(ctx, () => {})).toBe(true)
      expect(api.mock.calls.map(c => [c[0], Boolean(c[2])])).toEqual([['111/media', true], ['111/content_publishing_limit?fields=quota_usage,config', false]])
      const first = jobRow(aJobs[0].id), checkpoint = JSON.parse(first.resultJson!)
      expect(first).toMatchObject({ state: 'queued', attempts: 0 })
      expect(checkpoint).toMatchObject({ creating: false, publicationLimit: { cause: 'meta_refusal', windowSec: 7200, usage: 9, total: 9 } })
      expect(Date.parse(first.runAt)).toBe(Date.parse(published) + 7_200_000 + 60_000)
      expect(first.lastError).toMatch(/recusou.*9\/9 em 2 h/)
    } finally { spy.mockRestore() }
  })

  it('refusal without any valid reading keeps the existing 24-hour estimate and says so', async () => {
    const aJobs = schedule(container(1, at(5))).jobs
    now = new Date(now.getTime() + 5 * 60_000)
    const api = vi.fn().mockImplementation(async (path: string, _t: string, body?: unknown) => {
      if (path.includes('content_publishing_limit')) throw new InstagramApiError(400, 10)
      if (body) throw new InstagramApiError(400, 9, undefined, 2207042)
    })
    const spy = worker(api)
    try {
      await processNext(ctx, () => {})
      expect(jobRow(aJobs[0].id).lastError).toMatch(/Sem leitura válida da quota; retomada estimada por 24 horas/)
      expect(readQuotaSnapshot(ctx.db, ws, '111', now)).toMatchObject({ errorKind: 'permission', fetchedAt: null })
      expect(jobRow(aJobs[0].id).attempts).toBe(0)
    } finally { spy.mockRestore() }
  })

  it('an ambiguous remote publication is only polled, never re-posted, even with exhausted quota', async () => {
    const aJobs = schedule(container(1, at(5))).jobs
    ctx.db.update(jobs).set({ resultJson: JSON.stringify({ containerId: '987', publishing: true, exposedAt: at(4) }) }).where(eq(jobs.id, aJobs[0].id)).run()
    now = new Date(now.getTime() + 5 * 60_000)
    reading(9, 9, 3600)
    expect(accountQuota(ctx, ws, '111').breakdown).toMatchObject({ uncertainAfterSnapshot: 0, pending: 0 })
    const api = vi.fn().mockResolvedValue({ status_code: 'FINISHED' }), spy = worker(api)
    try {
      await processNext(ctx, () => {})
      expect(api.mock.calls.every(c => c[2] === undefined)).toBe(true)
      expect(api.mock.calls.map(c => c[0])).toEqual(['987?fields=status_code,status'])
      expect(JSON.parse(jobRow(aJobs[0].id).resultJson!)).toMatchObject({ containerId: '987', publishing: true })
    } finally { spy.mockRestore() }
  })

  it('leased job keeps its lease fencing: a deferral from an obsolete lease changes nothing', async () => {
    schedule(container(1, at(5)))
    now = new Date(now.getTime() + 5 * 60_000)
    reading(4, 4, 3600)
    const job = leaseNext(ctx.db, now, 60_000)!
    ctx.db.update(jobs).set({ leaseVersion: job.leaseVersion + 1 }).where(and(eq(jobs.id, job.id))).run()
    const { deferPublicationAccount } = await import('./instagram-publication-limit')
    expect(deferPublicationAccount(ctx, job, undefined, { resumeAt: at(60), checkedAt: now.toISOString() })).toBeNull()
    expect(jobRow(job.id)).toMatchObject({ state: 'running', attempts: job.attempts })
  })
})
