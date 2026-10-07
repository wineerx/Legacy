import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, copyFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl, getProfile } from '../repos/profiles'
import { getAsset, listAssets } from '../repos/assets'
import { jobs, remotePosts } from '../db/schema'
import { leaseNext, listJobs } from '../queue/queue'
import type { Ctx } from '../context'
import { makeTestVideo } from '../media/test-fixtures'
import { apifyJson, downloadVideo, downloadPreview } from './download-http'
import { profileImportProgress, fetchProfile, requestProfileDownload, runReelDownload, requestSelectedDownloads } from './profile-download'
import { setVideoStorage } from './storage'
import { setSetting } from '../repos/settings'

vi.mock('./download-http', async (original) => ({ ...await original<typeof import('./download-http')>(), apifyJson: vi.fn(), downloadVideo: vi.fn(), downloadPreview: vi.fn() }))
let ctx: Ctx
let ws: string
let profileId: string
const reel = { url: 'https://www.instagram.com/reel/ABCDE/', videoUrl: 'https://scontent.cdninstagram.com/video.mp4', caption: 'Legenda original', likesCount: -1, videoPlayCount: 123 }
beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubEnv('APIFY_TOKEN', 'test-token')
  ctx = { db: memDb(), dataRoot: await mkdtemp(join(tmpdir(), 'legacy-download-')), clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  profileId = addProfileFromUrl(ctx, ws, 'https://instagram.com/example/').id
  const avatarPath = join(ctx.dataRoot, 'cached-avatar.jpg')
  await writeFile(avatarPath, 'cached avatar')
  setSetting(ctx.db, ws, `profileAvatar.${profileId}`, avatarPath)
})
afterEach(() => vi.unstubAllEnvs())

function responses() {
  vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'READY' } })
    .mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } })
    .mockResolvedValueOnce([reel])
}
async function discover() {
  requestProfileDownload(ctx, ws, profileId, 10)
  const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
  responses()
  await fetchProfile(ctx, job)
  return job
}

describe('downloads de perfil', () => {
  it('descobre fotos e vídeos com prévia sem baixar vídeos até a seleção', async () => {
    requestProfileDownload(ctx, ws, profileId, 100, true)
    const job = leaseNext(ctx.db, ctx.clock(), 60000)!
    vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'READY' } }).mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } }).mockResolvedValueOnce([{ ...reel, displayUrl: 'https://scontent.cdninstagram.com/thumb.jpg' }, { url: 'https://www.instagram.com/p/PHOTO/', displayUrl: 'https://scontent.cdninstagram.com/photo.jpg', likesCount: 42 }])
    await fetchProfile(ctx, job)
    expect(apifyJson).toHaveBeenCalledWith(expect.stringContaining('instagram-scraper/runs'), 'test-token', expect.objectContaining({ resultsType: 'posts', directUrls: ['https://www.instagram.com/example/'] }))
    expect(ctx.db.select().from(remotePosts).all()).toHaveLength(2)
    expect(downloadPreview).toHaveBeenCalledTimes(2)
    expect(listJobs(ctx.db, ws).filter(j => j.type === 'download_reel')).toHaveLength(0)
    const video = ctx.db.select().from(remotePosts).all().find(p => p.permalink.includes('/reel/'))!
    const photo = ctx.db.select().from(remotePosts).all().find(p => p.permalink.includes('/p/'))!
    expect(() => requestSelectedDownloads(ctx, ws, [video.id, photo.id])).toThrow(/somente vídeos/)
    expect(requestSelectedDownloads(ctx, ws, [video.id])).toHaveLength(1)
  })
  it('rejeita falta de credencial, workspace cruzado e busca duplicada', () => {
    vi.stubEnv('APIFY_TOKEN', '')
    expect(() => requestProfileDownload(ctx, ws, profileId, 10)).toThrow(/APIFY_TOKEN/)
    vi.stubEnv('APIFY_TOKEN', 'test-token')
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    expect(() => requestProfileDownload(ctx, other, profileId, 10)).toThrow(/Perfil não encontrado/)
    requestProfileDownload(ctx, ws, profileId, 10)
    expect(() => requestProfileDownload(ctx, ws, profileId, 10)).toThrow(/Já existe/)
  })

  it('salva métricas ausentes como null, não confunde plays e views e retoma a execução sem novo POST', async () => {
    const job = await discover()
    expect(apifyJson).toHaveBeenCalledWith(expect.stringContaining('actors/'), 'test-token', expect.objectContaining({ username: ['https://www.instagram.com/example/'], resultsLimit: 10 }))
    expect(ctx.db.select().from(remotePosts).get()).toMatchObject({ caption: 'Legenda original', views: null, likes: null, comments: null })
    expect(getProfile(ctx.db, ws, profileId)?.lastSyncedAt).not.toBeNull()
    vi.mocked(apifyJson).mockClear().mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } }).mockResolvedValueOnce([reel])
    await fetchProfile(ctx, job)
    expect(apifyJson).toHaveBeenCalledTimes(2)
    expect(listJobs(ctx.db, ws).filter((j) => j.type === 'download_reel')).toHaveLength(1)
  })

  it('não repete criação de execução quando a resposta se perdeu', async () => {
    requestProfileDownload(ctx, ws, profileId, 10)
    const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
    vi.mocked(apifyJson).mockRejectedValueOnce(new Error('offline'))
    await expect(fetchProfile(ctx, job)).rejects.toThrow('offline')
    await expect(fetchProfile(ctx, job)).rejects.toThrow(/sem confirmação/)
    expect(apifyJson).toHaveBeenCalledTimes(1)
  })

  it('baixa, valida, registra procedência e reutiliza após reinício, na pasta configurada', async () => {
    await discover()
    const destination = await mkdtemp(join(tmpdir(), 'legacy-destination-'))
    const storage = await setVideoStorage(ctx, ws, destination)
    const fixture = join(ctx.dataRoot, 'fixture.mp4')
    await makeTestVideo(fixture)
    vi.mocked(downloadVideo).mockImplementation(async (_url, target) => { await copyFile(fixture, target) })
    const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
    const result = await runReelDownload(ctx, job) as { assetId: string }
    const asset = getAsset(ctx.db, ws, result.assetId)!
    expect(asset.origin).toBe('ig_third_party')
    expect(asset.rightsNote).toContain(reel.url)
    expect(asset.filePath.startsWith(storage.path)).toBe(true)
    await runReelDownload(ctx, job)
    expect(downloadVideo).toHaveBeenCalledTimes(1)
    expect(listAssets(ctx.db, ws)).toHaveLength(1)
    expect(await readdir(join(ctx.dataRoot, 'workspaces', ws, 'downloads', job.id))).toEqual([])
  })

  it('recusa conteúdo que não é vídeo e limpa temporários', async () => {
    await discover()
    vi.mocked(downloadVideo).mockImplementation(async (_url, target) => { await writeFile(target, '<html>login</html>') })
    const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
    await expect(runReelDownload(ctx, job)).rejects.toThrow(/vídeo/)
    expect(listAssets(ctx.db, ws)).toHaveLength(0)
    expect(await readdir(join(ctx.dataRoot, 'workspaces', ws, 'downloads', job.id))).toEqual([])
  })

  it('bloqueia dataset sem vídeos e destinos fora da allowlist', async () => {
    requestProfileDownload(ctx, ws, profileId, 10)
    const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
    responses()
    vi.mocked(apifyJson).mockReset().mockResolvedValueOnce({ data: { id: 'run1', status: 'READY' } }).mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } }).mockResolvedValueOnce([{ ...reel, videoUrl: 'https://127.0.0.1/secret' }])
    await expect(fetchProfile(ctx, job)).rejects.toThrow(/Nenhum post/)
    expect(ctx.db.select().from(jobs).where(eq(jobs.type, 'download_reel')).all()).toHaveLength(0)
  })
})

it('progresso real preserva runId, resultados ignorados e falhas de prévia', async () => {
  requestProfileDownload(ctx, ws, profileId, 100, true)
  const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  const sample = { ...reel, displayUrl: 'https://scontent.cdninstagram.com/thumb.jpg' }
  vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'READY' } })
    .mockImplementationOnce(async () => {
      expect(profileImportProgress(ctx, ws, profileId)?.progress).toMatchObject({ phase: 'searching', total: null, percent: null })
      return { data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } }
    }).mockResolvedValueOnce([sample, { invalid: true }])
  vi.mocked(downloadPreview).mockRejectedValueOnce(new Error('expired preview'))
  await fetchProfile(ctx, job)
  const result = profileImportProgress(ctx, ws, profileId)!
  expect(result.progress).toEqual({ phase: 'done', total: 2, processed: 2, imported: 1, skipped: 1, previewFailures: 1, percent: 100 })
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.resultJson!).runId).toBe('run1')
  const other = createWorkspace(ctx.db, { name: 'Other', timeZone: 'UTC' }).id
  expect(() => profileImportProgress(ctx, other, profileId)).toThrow(/Perfil não encontrado/)
})

it('atualização incremental reutiliza ID e não baixa outra prévia ou abre outro Actor no checkpoint', async () => {
  requestProfileDownload(ctx,ws,profileId,100,true)
  const job=leaseNext(ctx.db,ctx.clock(),60000)!
  const sample={...reel,id:'remote1',displayUrl:'https://scontent.cdninstagram.com/thumb.jpg'}
  vi.mocked(apifyJson).mockResolvedValueOnce({data:{id:'run1',status:'READY'}}).mockResolvedValueOnce({data:{id:'run1',status:'SUCCEEDED',defaultDatasetId:'ds1'}}).mockResolvedValueOnce([sample])
  await fetchProfile(ctx,job)
  vi.mocked(apifyJson).mockResolvedValueOnce({data:{id:'run1',status:'SUCCEEDED',defaultDatasetId:'ds1'}}).mockResolvedValueOnce([{...sample,caption:'Atualizada'}])
  await fetchProfile(ctx,job)
  expect(ctx.db.select().from(remotePosts).all()).toHaveLength(1)
  expect(ctx.db.select().from(remotePosts).all()[0].caption).toBe('Atualizada')
  expect(downloadPreview).toHaveBeenCalledTimes(1)
  expect(vi.mocked(apifyJson).mock.calls.filter(c=>c[0].includes('actors/'))).toHaveLength(1)
  expect(profileImportProgress(ctx,ws,profileId)?.progress).toMatchObject({imported:0,skipped:1,percent:100})
})
it('importa TikTok com metadados e avatar na grade, sem baixar vídeos automaticamente', async () => {
  const profile=addProfileFromUrl(ctx,ws,'https://www.tiktok.com/@example')
  requestProfileDownload(ctx,ws,profile.id,100,true)
  const job=leaseNext(ctx.db,ctx.clock(),60000)!
  vi.mocked(apifyJson).mockResolvedValueOnce({data:{id:'run2',status:'READY'}}).mockResolvedValueOnce({data:{id:'run2',status:'SUCCEEDED',defaultDatasetId:'ds2'}}).mockResolvedValueOnce([{id:'123456789',webVideoUrl:'https://www.tiktok.com/@example/video/123456789',text:'TikTok',playCount:123,diggCount:12,commentCount:3,createTime:1720000000,videoMeta:{duration:12,downloadAddr:'https://v16-webapp-prime.tiktok.com/video/a',coverUrl:'https://p16.tiktokcdn.com/cover.jpg'},authorMeta:{avatar:'https://p16.tiktokcdn.com/avatar.jpg'}}])
  await fetchProfile(ctx,job)
  expect(apifyJson).toHaveBeenCalledWith('actors/clockworks~tiktok-profile-scraper/runs?timeout=600','test-token',expect.objectContaining({profiles:['example'],shouldDownloadVideos:false}))
  expect(ctx.db.select().from(remotePosts).all()[0]).toMatchObject({caption:'TikTok',remoteId:'123456789',views:123,durationMs:12000})
  expect(downloadPreview).toHaveBeenCalledTimes(2)
  expect(listJobs(ctx.db,ws).filter(j=>j.type==='download_reel')).toHaveLength(0)
})

it('Todos combina as três origens, remove duplicatas e respeita o limite total', async () => {
  requestProfileDownload(ctx, ws, profileId, 2, true, 'all')
  const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  for (const [index, url] of ['https://www.instagram.com/p/POSTAA/', 'https://www.instagram.com/reel/REELAA/', 'https://www.instagram.com/p/TAGGED/'].entries()) {
    vi.mocked(apifyJson).mockResolvedValueOnce({data:{id:`run${index}`,status:'READY'}})
      .mockResolvedValueOnce({data:{id:`run${index}`,status:'SUCCEEDED',defaultDatasetId:`ds${index}`}})
      .mockResolvedValueOnce([{...reel,url}])
  }
  await fetchProfile(ctx, job)
  const inputs = vi.mocked(apifyJson).mock.calls.filter(call => call[0].includes('instagram-scraper/runs')).map(call => call[2])
  expect(inputs).toEqual(['posts','reels','mentions'].map(resultsType=>({directUrls:['https://www.instagram.com/example/'],resultsType,resultsLimit:2})))
  expect(ctx.db.select().from(remotePosts).all()).toHaveLength(2)
  // Retrying reuses all three remote runs instead of creating new billable runs.
  vi.mocked(apifyJson).mockClear()
  for (let index=0; index<3; index++) {
    vi.mocked(apifyJson).mockResolvedValueOnce({data:{id:`run${index}`,status:'SUCCEEDED',defaultDatasetId:`ds${index}`}}).mockResolvedValueOnce([reel])
  }
  await fetchProfile(ctx,job)
  expect(vi.mocked(apifyJson).mock.calls.some(call=>call[0].includes('actors/'))).toBe(false)
  expect(profileImportProgress(ctx,ws,profileId)?.progress?.total).toBe(1)
})

 it.each([['posts', 'posts'], ['reels', 'reels'], ['tagged', 'mentions']] as const)('busca a origem %s e preserva a preferência', async (source, resultsType) => {
  const queued = requestProfileDownload(ctx, ws, profileId, 10, true, source)
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, queued.id)).get()!.payloadJson)).toMatchObject({ source })
  const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  responses()
  await fetchProfile(ctx, job)
  expect(apifyJson).toHaveBeenCalledWith(expect.stringContaining('instagram-scraper/runs'), 'test-token', { directUrls: ['https://www.instagram.com/example/'], resultsType, resultsLimit: 10 })
  expect(listJobs(ctx.db, ws).filter(j => j.type === 'download_reel')).toHaveLength(0)
  ctx.db.update(jobs).set({ state: 'done' }).where(eq(jobs.id, job.id)).run()
  const next = requestProfileDownload(ctx, ws, profileId, 10, true)
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, next.id)).get()!.payloadJson)).toMatchObject({ source })
 })

it('busca foto da conta em details sem usar o autor de um post marcado', async () => {
  setSetting(ctx.db, ws, `profileAvatar.${profileId}`, 'missing-avatar.jpg')
  requestProfileDownload(ctx, ws, profileId, 10, true, 'tagged')
  const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  vi.mocked(apifyJson)
    .mockResolvedValueOnce({ data: { id: 'run1', status: 'READY' } })
    .mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } })
    .mockResolvedValueOnce([{ ...reel, ownerProfilePicUrl: 'https://scontent.cdninstagram.com/other.jpg' }])
    .mockResolvedValueOnce({ data: { id: 'avatar1', status: 'READY' } })
    .mockResolvedValueOnce({ data: { id: 'avatar1', status: 'SUCCEEDED', defaultDatasetId: 'avatarDs' } })
    .mockResolvedValueOnce([{ username: 'example', profilePicUrlHD: 'https://scontent.cdninstagram.com/account.jpg' }])
  await fetchProfile(ctx, job)
  expect(apifyJson).toHaveBeenCalledWith(expect.stringContaining('instagram-scraper/runs'), 'test-token', { directUrls: ['https://www.instagram.com/example/'], resultsType: 'details', resultsLimit: 1 })
  expect(downloadPreview).toHaveBeenCalledWith('https://scontent.cdninstagram.com/account.jpg', expect.stringContaining(`profile-${profileId}.jpg`))
  expect(downloadPreview).not.toHaveBeenCalledWith('https://scontent.cdninstagram.com/other.jpg', expect.anything())
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.resultJson!)).toMatchObject({ avatarRunId: 'avatar1', avatarChecked: true })
  expect(ctx.db.select().from(remotePosts).all()).toHaveLength(1)
})
it('falha da foto preserva os posts e registra o erro no checkpoint', async () => {
  setSetting(ctx.db, ws, `profileAvatar.${profileId}`, 'missing-avatar.jpg')
  requestProfileDownload(ctx, ws, profileId, 10, true)
  const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  responses()
  vi.mocked(apifyJson).mockRejectedValueOnce(new Error('avatar unavailable'))
  await fetchProfile(ctx, job)
  expect(ctx.db.select().from(remotePosts).all()).toHaveLength(1)
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.resultJson!)).toMatchObject({ avatarError: 'avatar unavailable', progress: { phase: 'done' } })
})


it('Todos preserva a criação sem confirmação de uma fonte sem repetir chamadas pagas', async () => {
  requestProfileDownload(ctx, ws, profileId, 2, true, 'all')
  const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED' } })
    .mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } })
    .mockResolvedValueOnce([reel])
    .mockRejectedValueOnce(new Error('network'))
  await expect(fetchProfile(ctx, job)).rejects.toThrow('network')
  vi.mocked(apifyJson).mockClear()
  vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } })
    .mockResolvedValueOnce([reel])
  await expect(fetchProfile(ctx, job)).rejects.toThrow('sem confirmação')
  expect(vi.mocked(apifyJson).mock.calls.some(call => call[0].startsWith('actors/'))).toBe(false)
})
