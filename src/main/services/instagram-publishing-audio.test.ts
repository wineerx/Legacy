import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { jobs, publicationContainerItems } from '../db/schema'
import { leaseNext } from '../queue/queue'
import { releaseAll } from './media-host/registry'
import { decryptSecret } from './integrations'
import { connectFacebookAccount, connectInstagram, facebookJson, instagramJson, accountTransport, publishInstagram, reelAudioConfiguration, scheduleComposition, type PublishDeps } from './instagram-publishing'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
const music = { audioId: '587784541076604', audioVolume: 100, videoVolume: 0 }
let ctx: Ctx; let ws: string; let assetId: string; let deps: PublishDeps
beforeEach(async () => {
  process.env.LEGACY_PROVIDER_NETWORK = 'off'
  ctx = { db: memDb(), dataRoot: 'C:/test', clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (w, key) => decryptSecret(ctx, vault, w, key)
  const file = join(mkdtempSync(join(tmpdir(), 'legacy-audio-')), 'IMG_2225_A_clean.mp4'); writeFileSync(file, 'x')
  assetId = insertAsset(ctx.db, { id: 'asset-audio', workspaceId: ws, origin: 'pc', sourceName: 'IMG_2225_A_clean.mp4', filePath: file, sha256: 'audio-sha', sizeBytes: 1, durationMs: 2000, width: 720, height: 1280, videoCodec: 'h264', validationJson: '{}', importedAt: ctx.clock().toISOString() }).id
  deps = { host: { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'https://t.trycloudflare.com/tok/video.mp4', release: vi.fn().mockResolvedValue(undefined) }) }, prepare: vi.fn().mockImplementation(async (input: string) => ({ path: input, cleanup: vi.fn() })) }
})
afterEach(async () => { await releaseAll() })

const facebook = () => connectFacebookAccount(ctx, vault, ws, { token: 'facebook-user-token', id: '17841400000000001', username: 'pagina', expiresAt: '2026-12-04T12:00:00.000Z', scopes: ['instagram_basic', 'instagram_content_publish'] })
function schedule(account: { id: string; revision: string }, audio?: typeof music, batchId = '00000000-0000-4000-8000-000000000001') {
  return scheduleComposition(ctx, ws, { batchId, assetIds: [assetId], accountId: account.id, accountRevision: account.revision, firstAt: '2026-10-05T12:02:00Z', intervalMin: 15, captions: { [assetId]: 'legenda' }, cleanupAfterPublish: false, ...(audio ? { audio: { [assetId]: audio } } : {}) })
}
function lease() { ctx.clock = () => new Date('2026-10-05T12:02:00Z'); return leaseNext(ctx.db, ctx.clock(), 60000)! }
const api = () => vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })

describe('música do catálogo Meta na publicação', () => {
  it('monta audio_configuration com volumes inteiros e omite o campo sem música', () => {
    expect(reelAudioConfiguration(music)).toEqual({ audio_configuration: '{"audio_id":"587784541076604","audio_volume":100,"video_volume":0}' })
    expect(reelAudioConfiguration(null)).toEqual({})
  })

  it('congela a música no payload e envia audio_configuration na criação do container, antes do media_publish', async () => {
    const account = facebook()
    schedule(account, music)
    const job = lease()
    expect(job.payload).toMatchObject({ audioId: music.audioId, audioVolume: 100, videoVolume: 0 })
    const frozen = ctx.db.select().from(publicationContainerItems).where(eq(publicationContainerItems.jobId, job.id)).get()!
    expect(JSON.parse(frozen.effectiveSnapshotJson!).audio).toEqual(music)
    const request = api()
    await publishInstagram(ctx, job, request, deps)
    expect(request.mock.calls[0][0]).toBe(`${account.id}/media`)
    expect(request.mock.calls[0][1]).toBe('facebook-user-token')
    expect(JSON.parse(request.mock.calls[0][2].audio_configuration)).toEqual({ audio_id: music.audioId, audio_volume: 100, video_volume: 0 })
    expect(request.mock.calls[2][0]).toBe(`${account.id}/media_publish`)
    expect(request.mock.calls[2][2]).not.toHaveProperty('audio_configuration')
  })

  it('mantém a criação do container sem audio_configuration para contas sem música', async () => {
    const account = await connectInstagram(ctx, vault, ws, 'instagram-token', vi.fn().mockResolvedValue({ user_id: '12345', username: 'destino' }))
    schedule(account)
    const job = lease()
    expect(job.payload).not.toHaveProperty('audioId')
    const request = api()
    await publishInstagram(ctx, job, request, deps)
    expect(Object.keys(request.mock.calls[0][2]).sort()).toEqual(['caption', 'media_type', 'share_to_feed', 'video_url'])
    expect(accountTransport(ctx, ws, account.id)).toBe(instagramJson)
    expect(accountTransport(ctx, ws, facebook().id)).toBe(facebookJson)
  })

  it('recusa música do catálogo em conta conectada pelo Instagram Login', async () => {
    const account = await connectInstagram(ctx, vault, ws, 'instagram-token', vi.fn().mockResolvedValue({ user_id: '12345', username: 'destino' }))
    expect(() => schedule(account, music)).toThrow(/Facebook Login/)
  })

  it('trata o mesmo lote com outra música ou outro volume como duplicidade, e o mesmo pedido como idempotente', () => {
    const account = facebook()
    const [first] = schedule(account, music)
    expect(schedule(account, music)[0].id).toBe(first.id)
    expect(() => schedule(account, { ...music, audioId: '111' })).toThrow(/outra configuração/)
    expect(() => schedule(account, { ...music, videoVolume: 30 })).toThrow(/outra configuração/)
    expect(() => schedule(account)).toThrow(/outra configuração/)
  })

  it('bloqueia a publicação quando a música do job diverge do payload congelado', async () => {
    const account = facebook()
    schedule(account, music)
    const job = lease()
    const tampered = { ...(job.payload as Record<string, unknown>), audioId: '999' }
    ctx.db.update(jobs).set({ payloadJson: JSON.stringify(tampered) }).where(and(eq(jobs.workspaceId, ws), eq(jobs.id, job.id))).run()
    const request = api()
    await expect(publishInstagram(ctx, { ...job, payload: tampered }, request, deps)).rejects.toThrow(/intenção congelada/)
    expect(request).not.toHaveBeenCalled()
  })

  it('reconectar pelo Facebook preserva a revisão e guarda o token só no cofre', async () => {
    const account = await connectInstagram(ctx, vault, ws, 'instagram-token', vi.fn().mockResolvedValue({ user_id: '17841400000000001', username: 'pagina' }))
    const again = facebook()
    expect(again.revision).toBe(account.revision)
    expect(again.authKind).toBe('facebook_login')
    expect(decryptSecret(ctx, vault, ws, `instagramToken:${again.id}`)).toBe('facebook-user-token')
    const stored = JSON.stringify(ctx.db.all('select value from settings'))
    expect(stored).not.toMatch(/"facebook-user-token/)
  })
})
