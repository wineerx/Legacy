import { expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mkdtemp, mkdir, writeFile, utimes, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { jobs, jobAttempts, providerLimits, publicationHistory } from '../db/schema'
import { enqueue, leaseNext, complete, deferJob } from '../queue/queue'
import { providerSucceeded } from './provider-limiter'
import { deferPublicationAccount, publicationResumeAt } from './instagram-publication-limit'
import { InstagramApiError } from './instagram-publishing'
import { queueContext } from './queue-monitor'
import { processedCacheDir, sweepProcessedCache } from './versions'
import type { Ctx } from '../context'

function setup() {
  const db = memDb(), now = new Date('2026-10-07T21:24:00Z')
  const ws = createWorkspace(db, { name: 'A', timeZone: 'UTC' }).id
  const ctx: Ctx = { db, dataRoot: 'C:/test', clock: () => now }
  const add = (accountId: string, at = now, workspaceId = ws) => enqueue(db, { workspaceId, type: 'publish_instagram',
    payload: { accountId, username: 'destino' }, runAt: at, label: 'Publicar' }, now)
  return { ctx, db, now, ws, add }
}

it('recognizes only HTTP 400 / 9 / 2207042 as a publication quota', () => {
  const e = new InstagramApiError(400, 9, undefined, 2207042)
  expect(e).toMatchObject({ publicationLimited: true, retryable: true, code: 'internal', apiSubcode: 2207042 })
  expect(e.message).toContain('Limite de publicações')
  for (const other of [new InstagramApiError(400, 9), new InstagramApiError(400, 9, undefined, 2207051), new InstagramApiError(400, 190, undefined, 2207042)]) {
    expect(other.publicationLimited).toBe(false)
    expect(other.retryable).toBe(false)
  }
})

it('estimates a rolling window by account and workspace, ignoring expired history and honoring Retry-After', () => {
  const { ctx, db, ws } = setup()
  for (const [id, accountId, publishedAt] of [['expired','A','2026-10-06T20:00:00Z'],['oldest','A','2026-10-06T23:24:00Z'],['later','A','2026-10-07T12:00:00Z'],['other','B','2026-10-06T22:00:00Z']]) {
    db.insert(publicationHistory).values({ jobId: id, workspaceId: ws, accountId, username: accountId, publishedAt: new Date(publishedAt).toISOString(), provenanceJson: '{}' }).run()
  }
  expect(publicationResumeAt(ctx, ws, 'A')).toBe('2026-10-07T23:25:00.000Z')
  expect(publicationResumeAt(ctx, ws, 'A', 3 * 3600_000)).toBe('2026-10-08T00:24:00.000Z')
  expect(publicationResumeAt(ctx, ws, 'unknown')).toBe('2026-10-07T22:24:00.000Z')
})

it('defers all 35 items atomically, keeps spacing/checkpoints/retries, gates one account and preserves order against priority', () => {
  const { ctx, db, ws, now, add } = setup()
  const pending = Array.from({ length: 35 }, (_, i) => add('A', new Date(now.getTime() + i * 15 * 60_000)))
  const job = leaseNext(db, now, 60000)!
  const checkpoint = { containerId: '123', publishing: false, processedCachePath: 'cached.mp4' }
  db.update(jobs).set({ resultJson: JSON.stringify(checkpoint) }).where(eq(jobs.id, job.id)).run()
  db.update(jobs).set({ priority: 2 }).where(eq(jobs.id, pending[1].id)).run()
  const resumeAt = deferPublicationAccount(ctx, job)!
  expect(resumeAt).toBe('2026-10-07T22:24:00.000Z')
  for (const [i, scheduled] of pending.entries()) {
    const row = db.select().from(jobs).where(eq(jobs.id, scheduled.id)).get()!
    expect(row.state).toBe('queued')
    expect(row.attempts).toBe(0)
    expect(Date.parse(row.runAt)).toBe(Date.parse(resumeAt) + i * 15 * 60_000)
    expect(queueContext(db, row, now)).toMatchObject({ stage: 'Conta limitada', needsAttention: false, publicationLimitUntil: row.runAt })
  }
  expect(JSON.parse(db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.resultJson!)).toMatchObject(checkpoint)
  expect(db.select().from(jobAttempts).all()[0]).toMatchObject({ outcome: 'retry', errorCode: 'publication_quota' })
  providerSucceeded(ctx, ws, 'A', 'status')
  expect(leaseNext(db, now, 60000)).toBeNull()
  const b = add('B'), tiktok = enqueue(db, { workspaceId: ws, type: 'export_tiktok', payload: {}, label: 'TikTok' }, now)
  const otherWs = createWorkspace(db, { name: 'B', timeZone: 'UTC' }).id, other = add('A', now, otherWs)
  const available = [leaseNext(db, now, 60000)!, leaseNext(db, now, 60000)!]
  // Provider concurrency is two; release both before checking the third eligible destination.
  for (const leased of available) complete(db, leased, now)
  available.push(leaseNext(db, now, 60000)!)
  expect(available.map(j => j.id).sort()).toEqual([b.id, tiktok.id, other.id].sort())
  complete(db, available[2], now)
  expect(leaseNext(db, new Date(Date.parse(resumeAt) + 16 * 60_000), 60000)!.id).toBe(job.id)
})

it('stale leases cannot move jobs or set account cooldowns', () => {
  const { ctx, db, now, add } = setup()
  add('A')
  const job = leaseNext(db, now, 60000)!
  expect(deferPublicationAccount(ctx, { ...job, leaseVersion: job.leaseVersion + 1 })).toBeNull()
  expect(db.select().from(providerLimits).all()).toEqual([])
  expect(db.select().from(jobs).all()[0].state).toBe('running')
})

it('polling time does not shrink the original interval between publications', () => {
  const { ctx, db, now, add } = setup()
  const first = add('A'), second = add('A', new Date(now.getTime() + 15 * 60_000))
  const job = leaseNext(db, now, 60000)!
  db.update(jobs).set({ runAt: new Date(now.getTime() + 45000).toISOString(), payloadJson: JSON.stringify({ accountId: 'A', publishAt: now.toISOString() }) }).where(eq(jobs.id, first.id)).run()
  const resume = deferPublicationAccount(ctx, job)!
  const next = db.select().from(jobs).where(eq(jobs.id, second.id)).get()!
  expect(Date.parse(next.runAt) - Date.parse(resume)).toBe(15 * 60_000)
})

it('a later item cannot overtake the first while it waits for a provider poll', () => {
  const { ctx, db, now, add } = setup()
  const first = add('A'), second = add('A', new Date(now.getTime() + 1000))
  const job = leaseNext(db, now, 60000)!
  const at = deferPublicationAccount(ctx, job)!
  const resume = new Date(at)
  const polling = leaseNext(db, resume, 60000)!
  expect(polling.id).toBe(first.id)
  expect(deferJob(db, polling, resume, 15000)).toBe(true)
  expect(leaseNext(db, new Date(resume.getTime() + 1000), 60000)).toBeNull()
  const ready = leaseNext(db, new Date(resume.getTime() + 15000), 60000)!
  expect(ready.id).toBe(first.id)
  complete(db, ready, new Date(resume.getTime() + 15000))
  expect(leaseNext(db, new Date(resume.getTime() + 15000), 60000)!.id).toBe(second.id)
})

it('a repeated refusal extends the existing cooldown without consuming an attempt', () => {
  const { ctx, db, now, add } = setup()
  add('A')
  const first = leaseNext(db, now, 60000)!
  const at = deferPublicationAccount(ctx, first)!
  ctx.clock = () => new Date(at)
  const second = leaseNext(db, ctx.clock(), 60000)!
  expect(deferPublicationAccount(ctx, second)).toBe('2026-10-07T23:24:00.000Z')
  expect(db.select().from(jobs).all()[0]).toMatchObject({ state: 'queued', attempts: 0 })
})

it('cache sweeping after restart preserves processed media referenced by pending publications', async () => {
  const { ctx, db, ws, add } = setup()
  ctx.dataRoot = await mkdtemp(join(tmpdir(), 'legacy-quota-cache-'))
  const dir = processedCacheDir(ctx, ws)
  await mkdir(dir, { recursive: true })
  const pinned = join(dir, 'cached.mp4'), stale = join(dir, 'unused.mp4')
  for (const file of [pinned, `${pinned}.json`, stale]) { await writeFile(file, 'x'); await utimes(file, new Date(0), new Date(0)) }
  const job = add('A')
  db.update(jobs).set({ resultJson: JSON.stringify({ processedCachePath: pinned }) }).where(eq(jobs.id, job.id)).run()
  await sweepProcessedCache(ctx, ws)
  await expect(access(pinned)).resolves.toBeUndefined()
  await expect(access(`${pinned}.json`)).resolves.toBeUndefined()
  await expect(access(stale)).rejects.toThrow()
})
