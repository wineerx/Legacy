import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { jobs } from '../db/schema'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { leaseNext } from '../queue/queue'
import { createContainer, scheduleContainer, readContainer, updateContainerDraft } from './publication-containers'
import { connectInstagram, publishInstagram, InstagramApiError, type PublishDeps } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { releaseAll } from './media-host/registry'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
let ctx: Ctx, ws: string, now: Date, root: string, rev: string, deps: PublishDeps, n = 0
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legacy-trial-'))
  now = new Date('2026-10-18T12:00:00.000Z')
  ctx = { db: memDb(), dataRoot: root, clock: () => now }
  ws = createWorkspace(ctx.db, { name: 'Trial', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (w, k) => decryptSecret(ctx, vault, w, k)
  rev = (await connectInstagram(ctx, vault, ws, 'token', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'a' }))).revision
  deps = { host: { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'https://synthetic.invalid/v.mp4', release: vi.fn().mockResolvedValue(undefined) }) }, prepare: vi.fn().mockImplementation(async path => ({ path, cleanup: vi.fn() })) }
})
afterEach(async () => { await releaseAll(); rmSync(root, { recursive: true, force: true }) })
function asset() { const id = `v-${++n}`, file = join(root, `${id}.mp4`); writeFileSync(file, id); return insertAsset(ctx.db, { id, workspaceId: ws, origin: 'pc', sourceName: `${id}.mp4`, filePath: file, sha256: `sha-${id}`, sizeBytes: 9, durationMs: 4000, width: 720, height: 1280, videoCodec: 'h264', validationJson: '{}', importedAt: now.toISOString() }).id }
function scheduled(trialGraduation: 'MANUAL' | 'SS_PERFORMANCE' | null) {
  const d = createContainer(ctx, ws, randomUUID(), { name: 'Teste', provider: 'instagram', destinationAccountId: '111', accountRevision: rev, plannedStartAt: '2026-10-18T13:00:00.000Z', intervalMin: 15, trialGraduation, items: [{ assetId: asset() }] })
  return scheduleContainer(ctx, ws, d.container.id, d.container.revision)
}
const due = () => { now = new Date('2026-10-18T13:00:00.000Z'); return leaseNext(ctx.db, now, 60_000)! }

it('the choice is stored on the draft, frozen into the job and sent as trial_params on the create call', async () => {
  const s = scheduled('SS_PERFORMANCE')
  expect(s.detail.container.trialGraduation).toBe('SS_PERFORMANCE')
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, s.jobs[0].id)).get()!.payloadJson)).toMatchObject({ trialGraduation: 'SS_PERFORMANCE' })
  const api = vi.fn().mockResolvedValueOnce({ id: '900' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '901' })
  await publishInstagram(ctx, due(), api, deps)
  expect(api.mock.calls[0][0]).toBe('111/media')
  expect(api.mock.calls[0][2]).toMatchObject({ media_type: 'REELS', trial_params: JSON.stringify({ graduation_strategy: 'SS_PERFORMANCE' }) })
})

it('a regular reel never sends trial_params', async () => {
  scheduled(null)
  const api = vi.fn().mockResolvedValueOnce({ id: '900' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '901' })
  await publishInstagram(ctx, due(), api, deps)
  expect(api.mock.calls[0][2]).not.toHaveProperty('trial_params')
})

it('a refusal by Meta explains eligibility and keeps no remote checkpoint; the option is frozen after scheduling', async () => {
  const s = scheduled('MANUAL')
  const job = due()
  const api = vi.fn().mockRejectedValueOnce(new InstagramApiError(400, 100))
  await expect(publishInstagram(ctx, job, api, deps)).rejects.toThrow(/Reels de teste.*não ser elegível/)
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.resultJson!)).toMatchObject({ creating: false })
  const c = readContainer(ctx, ws, s.detail.container.id).container
  expect(() => updateContainerDraft(ctx, ws, c.id, c.revision, { name: 'x', trialGraduation: null })).toThrow(/rascunhos/)
  // A payload edited after scheduling no longer matches the frozen item and is refused before any call.
  ctx.db.update(jobs).set({ payloadJson: JSON.stringify({ ...JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.payloadJson), trialGraduation: undefined }) }).where(eq(jobs.id, job.id)).run()
  const api2 = vi.fn()
  await expect(publishInstagram(ctx, { ...job, payload: JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.payloadJson) }, api2, deps)).rejects.toThrow(/intenção congelada/)
  expect(api2).not.toHaveBeenCalled()
})

it('the active account can only be a connected account of the workspace; new defaults never move scheduled jobs', async () => {
  const { setDefaultInstagramAccount, instagramAccount } = await import('./instagram-publishing')
  const s = scheduled(null)
  await connectInstagram(ctx, vault, ws, 'token-b', vi.fn().mockResolvedValue({ user_id: '222', id: '222', username: 'b' }))
  setDefaultInstagramAccount(ctx, ws, '111')
  expect(instagramAccount(ctx, ws)?.id).toBe('111')
  setDefaultInstagramAccount(ctx, ws, '222')
  expect(instagramAccount(ctx, ws)?.id).toBe('222')
  expect(() => setDefaultInstagramAccount(ctx, ws, '999')).toThrow(/não conectada/)
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, s.jobs[0].id)).get()!.payloadJson).accountId).toBe('111')
})
