import { repostWarnings } from './repost-check'
import { insertVersion } from '../repos/assets'
import { queryGrid } from './grid'
import { queryJobs } from '../queue/queue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { releaseAll } from './media-host/registry'
import type { PublishDeps } from './instagram-publishing'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { setSetting } from '../repos/settings'
import { decryptSecret } from './integrations'
import { connectInstagram, disconnectInstagram, scheduleInstagram, scheduleComposition, instagramAccount, publishInstagram, InstagramPending, InstagramApiError, verifyInstagram } from './instagram-publishing'
import {insertAsset} from '../repos/assets'
import {remotePosts,jobs} from '../db/schema'
import {eq} from 'drizzle-orm'
import { history } from './publication-history'
import { leaseNext } from '../queue/queue'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
let ctx: Ctx; let ws: string; let postId: string
let deps: PublishDeps; let release: ReturnType<typeof vi.fn>; let assetId: string
beforeEach(async () => {
  ctx = { db: memDb(), dataRoot: 'C:/test', clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (ws, key) => decryptSecret(ctx, vault, ws, key)
  const profile = addProfileFromUrl(ctx, ws, 'instagram.com/source')
  postId = addReelLink(ctx, ws, profile.id, 'https://www.instagram.com/reel/ABCDE/').id
  const file = join(mkdtempSync(join(tmpdir(), 'legacy-pub-')), 'reel.mp4'); writeFileSync(file, 'x')
  assetId = insertAsset(ctx.db, { id: 'asset-post', workspaceId: ws, origin: 'ig_third_party', sourceName: 'reel.mp4', filePath: file, sha256: 'post-sha', sizeBytes: 1, durationMs: 2000, width: 720, height: 1280, videoCodec: 'h264', validationJson: '{}', importedAt: ctx.clock().toISOString() }).id
  ctx.db.update(remotePosts).set({ assetId }).where(eq(remotePosts.id, postId)).run()
  release = vi.fn().mockResolvedValue(undefined)
  deps = { host: { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'https://t.trycloudflare.com/tok/video.mp4', release }) }, prepare: vi.fn().mockImplementation(async (input: string) => ({ path: input, cleanup: vi.fn() })) }
  setSetting(ctx.db, ws, `remoteMedia.${postId}`, JSON.stringify({ videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }))
  await connectInstagram(ctx, vault, ws, 'private-token', vi.fn().mockResolvedValue({ id: 'app-scoped', user_id: '12345', username: 'destination' }))
})
afterEach(async () => { await releaseAll() })
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
    await expect(publishInstagram(ctx, job, api, deps)).rejects.toThrow(/Token Instagram inválido/)
    expect(history(ctx, ws)).toHaveLength(0)
    api.mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    await publishInstagram(ctx, job, api, deps); expect(history(ctx, ws)).toHaveLength(1)
    disconnectInstagram(ctx, vault, ws)
    expect(await publishInstagram(ctx, job, api, deps)).toMatchObject({ confirmedPublished: true })
    expect(api).toHaveBeenCalledTimes(4)
  })
  it('agenda no futuro, sem guardar token no payload, e publica uma vez', async () => {
    const job = leased(); expect(JSON.stringify(job)).not.toContain('private-token')
    const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    expect(await publishInstagram(ctx, job, api, deps)).toMatchObject({ mediaId: '456' })
    await publishInstagram(ctx, job, api, deps)
    expect(api).toHaveBeenCalledTimes(3)
    expect(api).toHaveBeenLastCalledWith('12345/media_publish', 'private-token', { creation_id: '987' })
  })
  it('troca de conta invalida o destino antes de enviar', async () => {
    const job = leased(); disconnectInstagram(ctx, vault, ws)
    const api = vi.fn(); await expect(publishInstagram(ctx, job, api, deps)).rejects.toThrow(/conta conectada mudou/)
    expect(api).not.toHaveBeenCalled()
  })
  it('retoma o mesmo container em um minuto', async () => {
    const job = leased(); const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'IN_PROGRESS' })
    await expect(publishInstagram(ctx, job, api, deps)).rejects.toBeInstanceOf(InstagramPending)
    api.mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    await publishInstagram(ctx, job, api, deps)
    expect(api.mock.calls.filter(c => c[0] === '12345/media')).toHaveLength(1)
  })
  it('resposta de publicação perdida não causa outro POST', async () => {
    const job = leased(); const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockRejectedValueOnce(new Error('response lost'))
    await expect(publishInstagram(ctx, job, api, deps)).rejects.toThrow('response lost')
    api.mockResolvedValueOnce({ status_code: 'FINISHED' })
    await expect(publishInstagram(ctx, job, api, deps)).rejects.toBeInstanceOf(InstagramPending)
    expect(api.mock.calls.filter(c => c[0] === '12345/media_publish')).toHaveLength(1)
    api.mockResolvedValueOnce({ status_code: 'PUBLISHED' })
    expect(await publishInstagram(ctx, job, api, deps)).toMatchObject({ confirmedPublished: true })
  })
  it('cria o container com a URL do host e libera após FINISHED', async () => {
    const job = leased()
    const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    await publishInstagram(ctx, job, api, deps)
    expect(api).toHaveBeenNthCalledWith(1, '12345/media', 'private-token', expect.objectContaining({ video_url: 'https://t.trycloudflare.com/tok/video.mp4', media_type: 'REELS' }))
    expect(release).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(job.payload)).not.toContain('trycloudflare')
  })
  it('ERROR libera, mostra o código e a nova tentativa cria outro container', async () => {
    const job = leased()
    const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'ERROR', status: 'Error: 2207026' })
    await expect(publishInstagram(ctx, job, api, deps)).rejects.toThrow(/link temporário.*código Meta 2207026/)
    expect(release).toHaveBeenCalledTimes(1)
    api.mockResolvedValueOnce({ id: '988' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    await publishInstagram(ctx, job, api, deps)
    expect(api.mock.calls.filter(c => c[0] === '12345/media')).toHaveLength(2)
    expect(api).toHaveBeenLastCalledWith('12345/media_publish', 'private-token', { creation_id: '988' })
  })
  it('IN_PROGRESS consulta de novo em 15 s e falha após 15 min', async () => {
    const job = leased()
    const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'IN_PROGRESS' })
    const pending = await publishInstagram(ctx, job, api, deps).catch(e => e)
    expect(pending).toBeInstanceOf(InstagramPending); expect(pending.retryAfterMs).toBe(15_000)
    ctx.clock = () => new Date('2026-10-05T12:18:00Z')
    api.mockResolvedValueOnce({ status_code: 'IN_PROGRESS' })
    await expect(publishInstagram(ctx, job, api, deps)).rejects.toThrow(/link temporário/)
  })
  it('sem arquivo local falha pedindo o download', async () => {
    const job = leased()
    ctx.db.update(remotePosts).set({ assetId: null }).where(eq(remotePosts.id, postId)).run()
    ctx.db.update(jobs).set({ payloadJson: JSON.stringify({ ...(job.payload as object), localAssetId: null }) }).where(eq(jobs.id, job.id)).run()
    await expect(publishInstagram(ctx, { ...job, payload: { ...(job.payload as object), localAssetId: null } }, vi.fn(), deps)).rejects.toThrow(/Baixe ou importe o vídeo/)
  })
  it('payload antigo da 0.6 (videoUrl, localAssetId nulo) publica pela cópia local via host', async () => {
    const job = leased()
    const { localAssetId: _drop, ...rest } = job.payload as Record<string, unknown>; void _drop
    const old = { ...rest, postId, localAssetId: null, videoUrl: 'https://scontent.cdninstagram.com/old.mp4' }
    ctx.db.update(jobs).set({ payloadJson: JSON.stringify(old) }).where(eq(jobs.id, job.id)).run()
    const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
    expect(await publishInstagram(ctx, { ...job, payload: old }, api, deps)).toMatchObject({ confirmedPublished: true })
    expect(deps.prepare).toHaveBeenCalledWith(expect.stringMatching(/reel\.mp4$/), expect.any(String))
    expect(api).toHaveBeenNthCalledWith(1, '12345/media', 'private-token', expect.objectContaining({ video_url: 'https://t.trycloudflare.com/tok/video.mp4' }))
    expect(JSON.stringify(api.mock.calls)).not.toContain('scontent.cdninstagram.com')
    expect(api).toHaveBeenLastCalledWith('12345/media_publish', 'private-token', { creation_id: '987' })
  })
  it('erro 4xx na criação libera a exposição', async () => {
    const job = leased(); const api = vi.fn().mockRejectedValueOnce(new InstagramApiError(400, 100))
    await expect(publishInstagram(ctx, job, api, deps)).rejects.toThrow(/Parâmetro recusado/)
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('agendamento pela grade exige vídeo baixado', () => {
    ctx.db.update(remotePosts).set({ assetId: null }).where(eq(remotePosts.id, postId)).run()
    expect(() => scheduleInstagram(ctx, ws, { postIds: [postId], firstAt: '2026-10-05T12:02:00Z', intervalMin: 60 })).toThrow(/Baixe o vídeo antes de agendar/)
  })
  it('rejeita outro workspace e horário passado sem enfileirar', () => {
    expect(() => scheduleInstagram(ctx, ws, { postIds: [postId], firstAt: '2026-10-05T11:00:00Z', intervalMin: 60 })).toThrow(/futuro/)
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    expect(() => scheduleInstagram(ctx, other, { postIds: [postId], firstAt: '2026-10-05T12:02:00Z', intervalMin: 60 })).toThrow(/Conecte/)
  })
})

it('compõe publicação local ou remota com destino fixo e legenda por vídeo',()=>{
 const asset=insertAsset(ctx.db,{id:'asset-compose',workspaceId:ws,origin:'ig_third_party',sourceName:'reel.mp4',filePath:'C:/test/reel.mp4',sha256:'compose-sha',sizeBytes:1,durationMs:2000,width:720,height:1280,videoCodec:'h264',validationJson:'{}',importedAt:ctx.clock().toISOString()})
 const account=instagramAccount(ctx,ws)!
 const input={assetIds:[asset.id],accountId:account.id,accountRevision:account.revision,firstAt:'2026-10-05T12:02:00Z',intervalMin:60,captions:{[asset.id]:'Legenda própria'},cleanupAfterPublish:false}
 const local=scheduleComposition(ctx,ws,input)
 expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id,local[0].id)).get()!.payloadJson)).toMatchObject({postId:null,localAssetId:asset.id,caption:'Legenda própria'})
 ctx.db.delete(jobs).where(eq(jobs.id,local[0].id)).run()
 ctx.db.update(remotePosts).set({assetId:asset.id}).where(eq(remotePosts.id,postId)).run()
 expect(()=>scheduleComposition(ctx,ws,{...input,accountId:'000'})).toThrow(/destino mudou/)
 const result=scheduleComposition(ctx,ws,input)
 expect(result).toHaveLength(1)
 expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id,result[0].id)).get()!.payloadJson)).toMatchObject({caption:'Legenda própria',accountId:account.id,postId})
 expect(()=>scheduleComposition(ctx,ws,{...input,captions:{[asset.id]:'x'.repeat(2201)}})).toThrow(/2200/)
})

it('recusa versão editada inexistente antes de criar tarefas Instagram', () => {
 const account=instagramAccount(ctx,ws)!
 expect(()=>scheduleComposition(ctx,ws,{assetIds:['asset-local'],accountId:account.id,accountRevision:account.revision,firstAt:'2026-10-05T12:02:00Z',intervalMin:60,captions:{},cleanupAfterPublish:false,versionIds:{'asset-local':'edited-version'}})).toThrow(/Versão editada/)
 expect(ctx.db.select().from(jobs).all()).toHaveLength(0)
})

 it('retoma contêiner antigo ERROR pela cópia local sem reutilizar o CDN', async () => {
  const job = leased()
  ctx.db.update(jobs).set({resultJson:JSON.stringify({creating:true,containerId:'111'})}).where(eq(jobs.id,job.id)).run()
  const api=vi.fn().mockResolvedValueOnce({status_code:'ERROR'})
  await expect(publishInstagram(ctx,job,api,deps)).rejects.toBeInstanceOf(InstagramPending)
  const checkpoint=JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id,job.id)).get()!.resultJson!)
  expect(checkpoint).toMatchObject({creating:false,failedContainers:[{id:'111',status:'ERROR'}]})
  api.mockResolvedValueOnce({id:'222'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'333'})
  await publishInstagram(ctx,job,api,deps)
  expect(api).toHaveBeenLastCalledWith('12345/media_publish','private-token',{creation_id:'222'})
 })
 it('erro após publicação ambígua preserva o checkpoint e não recria vídeo', async () => {
  const job=leased()
  ctx.db.update(jobs).set({resultJson:JSON.stringify({creating:true,containerId:'111',publishing:true})}).where(eq(jobs.id,job.id)).run()
  const api=vi.fn().mockResolvedValue({status_code:'ERROR'})
  await expect(publishInstagram(ctx,job,api,deps)).rejects.toThrow(/sem confirmação/)
  expect(api).toHaveBeenCalledTimes(1)
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id,job.id)).get()!.resultJson!)).toMatchObject({containerId:'111',publishing:true})
  expect(deps.host.expose).not.toHaveBeenCalled()
 })
 it('estado desconhecido não descarta um contêiner existente', async () => {
  const job=leased()
  ctx.db.update(jobs).set({resultJson:JSON.stringify({containerId:'111'})}).where(eq(jobs.id,job.id)).run()
  await expect(publishInstagram(ctx,job,vi.fn().mockResolvedValue({status_code:'UNKNOWN'}),deps)).rejects.toThrow(/desconhecido/)
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id,job.id)).get()!.resultJson!)).toMatchObject({containerId:'111'})
 })

it('avisa repostagem pela conta/histórico/hash, exige confirmação e mantém outros destinos independentes', async () => {
  const job = leased()
  expect(repostWarnings(ctx, ws, '12345', { assetIds: [assetId] })[0].reason).toMatch(/andamento/)
  await publishInstagram(ctx, job, vi.fn().mockResolvedValueOnce({id:'987'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'456'}), deps)
  const next = { postIds: [postId], firstAt: '2026-10-05T14:00:00Z', intervalMin: 60 }
  expect(() => scheduleInstagram(ctx, ws, next)).toThrow(/repostagem/)
  expect(scheduleInstagram(ctx, ws, {...next,allowRepost:true})).toHaveLength(1)
  expect(repostWarnings(ctx, ws, '999', { postIds: [postId] })).toEqual([])
  const queue = queryJobs(ctx.db, { workspaceId: ws, page: 1, pageSize: 25, search: '' })
  expect(queue.items.find(i => i.id === job.id)?.publishedVideo).toMatchObject({assetId,name:'reel.mp4'})
  expect(queryGrid(ctx.db, {workspaceId:ws,source:'library',publicationJobId:job.id,sortBy:'importedAt',sortDir:'desc',limit:60,offset:0}).items.map(i=>i.id)).toEqual([assetId])
})
it('envia a versão editada local e referencia o primeiro frame como thumbnail', async () => {
  const account = instagramAccount(ctx, ws)!
  const path = join(mkdtempSync(join(tmpdir(),'legacy-edited-')), 'edited.mp4'); writeFileSync(path,'edited')
  insertVersion(ctx.db, {id:'edited',workspaceId:ws,assetId,kind:'banner',paramsJson:'{}',filePath:path,createdAt:ctx.clock().toISOString()})
  scheduleComposition(ctx,ws,{assetIds:[assetId],accountId:account.id,accountRevision:account.revision,firstAt:'2026-10-05T12:02:00Z',intervalMin:60,captions:{},cleanupAfterPublish:false,versionIds:{[assetId]:'edited'}})
  ctx.clock=()=>new Date('2026-10-05T12:02:00Z')
  const job = leaseNext(ctx.db,ctx.clock(),60000)!
  const api=vi.fn().mockResolvedValueOnce({id:'987'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'456'})
  await publishInstagram(ctx,job,api,deps)
  expect(deps.prepare).toHaveBeenCalledWith(path,expect.any(String))
  expect(api.mock.calls[0][2]).toMatchObject({thumb_offset:'0'})
})

it('detecta dois registros de origem do mesmo arquivo dentro do lote', () => {
 const profile=addProfileFromUrl(ctx,ws,'instagram.com/source')
 const second=addReelLink(ctx,ws,profile.id,'https://www.instagram.com/reel/FGHIJ/')
 ctx.db.update(remotePosts).set({assetId}).where(eq(remotePosts.id,second.id)).run()
 expect(repostWarnings(ctx,ws,'12345',{postIds:[postId,second.id]})).toEqual([expect.objectContaining({id:assetId,reason:'Este lote contém o mesmo vídeo mais de uma vez.'})])
 expect(()=>scheduleInstagram(ctx,ws,{postIds:[postId,second.id],firstAt:'2026-10-05T12:02:00Z',intervalMin:60})).toThrow(/repostagem/)
})


it('publica vídeo do PC sem origem remota e preserva histórico, deduplicação e foco na Biblioteca', async () => {
  ctx.db.delete(remotePosts).where(eq(remotePosts.id, postId)).run()
  const account = instagramAccount(ctx, ws)!
  const input = { assetIds: [assetId], accountId: account.id, accountRevision: account.revision, firstAt: '2026-10-05T12:02:00Z', intervalMin: 60, captions: { [assetId]: 'Vídeo local' }, cleanupAfterPublish: false }
  const scheduled = scheduleComposition(ctx, ws, input)
  expect(scheduleComposition(ctx, ws, input)[0].id).toBe(scheduled[0].id)
  ctx.clock = () => new Date(input.firstAt)
  const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  const api = vi.fn().mockResolvedValueOnce({ id: '987' }).mockResolvedValueOnce({ status_code: 'FINISHED' }).mockResolvedValueOnce({ id: '456' })
  await publishInstagram(ctx, job, api, deps)
  await publishInstagram(ctx, job, api, deps)
  expect(api).toHaveBeenCalledTimes(3)
  expect(history(ctx, ws)[0]).toMatchObject({ postId: null, assetSha: 'post-sha', mediaId: '456' })
  expect(JSON.parse(history(ctx, ws)[0].provenanceJson)).toMatchObject({ assetId, sourceName: 'reel.mp4' })
  expect(repostWarnings(ctx, ws, account.id, { assetIds: [assetId] })[0].reason).toContain('já foi publicado')
  const grid = queryGrid(ctx.db, { workspaceId: ws, source: 'library', publicationJobId: job.id, sortBy: 'importedAt', sortDir: 'desc', offset: 0, limit: 24 })
  expect(grid.total).toBe(1)
  expect(grid.items[0].id).toBe(assetId)
})
