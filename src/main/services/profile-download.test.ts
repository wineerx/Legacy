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
import { apifyJson, downloadVideo } from './download-http'
import { fetchProfile, requestProfileDownload, runReelDownload } from './profile-download'
import { setVideoStorage } from './storage'

vi.mock('./download-http', async (original) => ({ ...await original<typeof import('./download-http')>(), apifyJson: vi.fn(), downloadVideo: vi.fn() }))
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
    await expect(fetchProfile(ctx, job)).rejects.toThrow(/Nenhum reel/)
    expect(ctx.db.select().from(jobs).where(eq(jobs.type, 'download_reel')).all()).toHaveLength(0)
  })
})
