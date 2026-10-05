import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { setSetting } from '../repos/settings'
import { decryptSecret } from './integrations'
import { connectInstagram, disconnectInstagram, scheduleInstagram, publishInstagram, InstagramPending, InstagramApiError, verifyInstagram } from './instagram-publishing'
import { history } from './publication-history'
import { leaseNext } from '../queue/queue'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
let ctx: Ctx; let ws: string; let postId: string
beforeEach(async () => {
  ctx = { db: memDb(), dataRoot: 'C:/test', clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (ws, key) => decryptSecret(ctx, vault, ws, key)
  const profile = addProfileFromUrl(ctx, ws, 'instagram.com/source')
  postId = addReelLink(ctx, ws, profile.id, 'https://www.instagram.com/reel/ABCDE/').id
  setSetting(ctx.db, ws, `remoteMedia.${postId}`, JSON.stringify({ videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }))
  await connectInstagram(ctx, vault, ws, 'private-token', vi.fn().mockResolvedValue({ id: 'app-scoped', user_id: '12345', username: 'destination' }))
})
function leased() {
  scheduleInstagram(ctx, ws, { postIds: [postId], firstAt: '2026-10-05T12:02:00Z', intervalMin: 60 })
  expect(leaseNext(ctx.db, ctx.clock(), 60000)).toBeNull()
  ctx.clock = () => new Date('2026-10-05T12:02:00Z')
  return leaseNext(ctx.db, ctx.clock(), 60000)!
}
describe('publicação agendada Instagram', () => {
  it('usa user_id profissional, nunca o id no escopo do app', async () => {
    const api = vi.fn().mockResolvedValue({ id: '777', user_id: '12345', username: 'destination' })
    const account = await connectInstagram(ctx, vault, ws, 'private-token', api)
    expect(account.id).toBe('12345'); expect(api).toHaveBeenCalledWith('me?fields=user_id,username', 'private-token')
    expect((await verifyInstagram(ctx, vault, ws, api)).revision).toBe(account.revision)
  })
  it('recusa token que retorna somente id sem apagar conexão anterior', async () => {
    await expect(connectInstagram(ctx, vault, ws, 'wrong-token', vi.fn().mockResolvedValue({ id: '777', username: 'wrong' }))).rejects.toThrow(/token não retornou/)
    expect(decryptSecret(ctx, vault, ws, 'instagramToken')).toBe('private-token')
  })
  it('erro HTTP definitivo permite retentativa, resposta perdida permanece bloqueada', async () => {
    const job = leased(); const api = vi.fn().mockRejectedValueOnce(new InstagramApiError(400, 190))
    await expect(publishInstagram(ctx, job, api)).rejects.toThrow(/Token Instagram inválido/)
    expect(history(ctx, ws)).toHaveLength(0)
    api.mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    await publishInstagram(ctx, job, api); expect(history(ctx, ws)).toHaveLength(1)
    disconnectInstagram(ctx, vault, ws)
    expect(await publishInstagram(ctx, job, api)).toMatchObject({ confirmedPublished: true })
    expect(api).toHaveBeenCalledTimes(4)
  })
  it('agenda no futuro, sem guardar token no payload, e publica uma vez', async () => {
    const job = leased(); expect(JSON.stringify(job)).not.toContain('private-token')
    const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    expect(await publishInstagram(ctx, job, api)).toMatchObject({ mediaId: '456' })
    await publishInstagram(ctx, job, api)
    expect(api).toHaveBeenCalledTimes(3)
    expect(api).toHaveBeenLastCalledWith('12345/media_publish', 'private-token', { creation_id: '987' })
  })
  it('troca de conta invalida o destino antes de enviar', async () => {
    const job = leased(); disconnectInstagram(ctx, vault, ws)
    const api = vi.fn(); await expect(publishInstagram(ctx, job, api)).rejects.toThrow(/conta conectada mudou/)
    expect(api).not.toHaveBeenCalled()
  })
  it('retoma o mesmo container em um minuto', async () => {
    const job = leased(); const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'IN_PROGRESS' })
    await expect(publishInstagram(ctx, job, api)).rejects.toBeInstanceOf(InstagramPending)
    api.mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    await publishInstagram(ctx, job, api)
    expect(api.mock.calls.filter(c => c[0] === '12345/media')).toHaveLength(1)
  })
  it('resposta de publicação perdida não causa outro POST', async () => {
    const job = leased(); const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockRejectedValueOnce(new Error('response lost'))
    await expect(publishInstagram(ctx, job, api)).rejects.toThrow('response lost')
    api.mockResolvedValueOnce({ status_code: 'FINISHED' })
    await expect(publishInstagram(ctx, job, api)).rejects.toThrow(/sem confirmação/)
    expect(api.mock.calls.filter(c => c[0] === '12345/media_publish')).toHaveLength(1)
    api.mockResolvedValueOnce({ status_code: 'PUBLISHED' })
    expect(await publishInstagram(ctx, job, api)).toMatchObject({ confirmedPublished: true })
  })
  it('rejeita outro workspace e horário passado sem enfileirar', () => {
    expect(() => scheduleInstagram(ctx, ws, { postIds: [postId], firstAt: '2026-10-05T11:00:00Z', intervalMin: 60 })).toThrow(/futuro/)
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    expect(() => scheduleInstagram(ctx, other, { postIds: [postId], firstAt: '2026-10-05T12:02:00Z', intervalMin: 60 })).toThrow(/Conecte/)
  })
})
