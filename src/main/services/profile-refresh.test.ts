import { afterEach, expect, it, vi } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl, getProfile } from '../repos/profiles'
import { remotePosts, jobs } from '../db/schema'
import { apifyJson, downloadVideo, downloadPreview } from './download-http'
import { refreshProfile, profileMetrics } from './profile-refresh'

vi.mock('./download-http', () => ({ apifyJson: vi.fn(), downloadVideo: vi.fn(), downloadPreview: vi.fn() }))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })
it('atualiza somente identidade e métricas, ignorando posts embutidos e sem downloads', async () => {
  vi.stubEnv('APIFY_TOKEN', 'token')
  const db = memDb()
  const ws = createWorkspace(db, { name: 'A', timeZone: 'UTC' }).id
  const ctx = { db, dataRoot: '.', clock: () => new Date('2026-10-06T12:00:00Z') }
  const profile = addProfileFromUrl(ctx, ws, '@example')
  vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'READY' } })
    .mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } })
    .mockResolvedValueOnce([{ username: 'renamed', postsCount: 45, followersCount: 100, followsCount: 10, latestPosts: [{ url: 'https://instagram.com/reel/ABCDE/' }] }])
  expect(await refreshProfile(ctx, ws, profile.id)).toMatchObject({ postsCount: 45, reelsCount: null, followersCount: 100 })
  expect(getProfile(db, ws, profile.id)?.username).toBe('renamed')
  expect(profileMetrics(ctx, ws, profile.id)?.postsCount).toBe(45)
  expect(apifyJson).toHaveBeenNthCalledWith(1, 'actors/apify~instagram-scraper/runs?timeout=600', 'token', { directUrls: [profile.url], resultsType: 'details', resultsLimit: 1 })
  expect(db.select().from(remotePosts).all()).toHaveLength(0)
  expect(db.select().from(jobs).all()).toHaveLength(0)
  expect(downloadVideo).not.toHaveBeenCalled()
  expect(downloadPreview).not.toHaveBeenCalled()
})


it('retoma a mesma consulta após falha no dataset sem iniciar outra execução paga', async () => {
  vi.stubEnv('APIFY_TOKEN', 'token')
  const db = memDb()
  const ws = createWorkspace(db, { name: 'A', timeZone: 'UTC' }).id
  const ctx = { db, dataRoot: '.', clock: () => new Date() }
  const profile = addProfileFromUrl(ctx, ws, '@example')
  vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } })
    .mockRejectedValueOnce(new Error('network'))
  await expect(refreshProfile(ctx, ws, profile.id)).rejects.toThrow('network')
  vi.mocked(apifyJson).mockClear()
  vi.mocked(apifyJson).mockResolvedValueOnce({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } })
    .mockResolvedValueOnce([{ username: 'example', postsCount: 45 }])
  expect(await refreshProfile(ctx, ws, profile.id)).toMatchObject({ postsCount: 45, followersCount: null })
  expect(apifyJson).toHaveBeenCalledTimes(2)
  expect(vi.mocked(apifyJson).mock.calls.some(call => call[0].startsWith('actors/'))).toBe(false)
})

it('uma criação sem resposta não é reenviada automaticamente', async () => {
  vi.stubEnv('APIFY_TOKEN', 'token')
  const db = memDb()
  const ws = createWorkspace(db, { name: 'A', timeZone: 'UTC' }).id
  const ctx = { db, dataRoot: '.', clock: () => new Date() }
  const profile = addProfileFromUrl(ctx, ws, '@example')
  vi.mocked(apifyJson).mockRejectedValueOnce(new Error('network'))
  await expect(refreshProfile(ctx, ws, profile.id)).rejects.toThrow('network')
  await expect(refreshProfile(ctx, ws, profile.id)).rejects.toThrow('sem confirmação')
  expect(apifyJson).toHaveBeenCalledTimes(1)
})
