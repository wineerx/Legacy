import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { getAsset } from '../repos/assets'
import { setSetting } from '../repos/settings'
import { remotePosts } from '../db/schema'
import { enqueue, leaseNext } from '../queue/queue'
import { ffmpegPaths } from '../media/ffmpeg-bin'
import { runTool } from '../media/run'
import { probe } from '../media/probe'
import { runReelDownload, requestSelectedDownloads } from './profile-download'
import { downloadVideo } from './download-http'
import type { Ctx } from '../context'
vi.mock('./download-http', async original => ({ ...await original<typeof import('./download-http')>(), downloadVideo: vi.fn() }))
let ctx: Ctx; let ws: string; let postId: string; let video: string; let audio: string
beforeEach(async () => {
  vi.resetAllMocks(); const root = await mkdtemp(join(tmpdir(), 'legacy-download-audio-')); ctx = { db: memDb(), dataRoot: root, clock: () => new Date('2026-10-05T12:00:00Z') }; ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  const profile = addProfileFromUrl(ctx, ws, '@origin'); postId = addReelLink(ctx, ws, profile.id, 'https://instagram.com/reel/ABCDE/').id
  video = join(root, 'video.mp4'); audio = join(root, 'audio.m4a')
  await runTool(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=4', '-c:v', 'libopenh264', video])
  await runTool(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'aac', audio])
  vi.mocked(downloadVideo).mockImplementation(async (url, target) => { await copyFile(url.includes('audio') ? audio : video, target) })
})
afterEach(async () => { await rm(ctx.dataRoot, { recursive: true, force: true }) })
it('profile selection downloads and muxes both tracks; stored file and metadata keep audio', async () => {
  setSetting(ctx.db, ws, `remoteMedia.${postId}`, JSON.stringify({ videoUrl: 'https://scontent.cdninstagram.com/video.mp4', audioUrl: 'https://scontent.cdninstagram.com/audio.m4a' }))
  requestSelectedDownloads(ctx, ws, [postId]); const job = leaseNext(ctx.db, ctx.clock(), 60000)!
  const result = await runReelDownload(ctx, job) as { assetId: string }; const asset = getAsset(ctx.db, ws, result.assetId)!
  expect(downloadVideo).toHaveBeenCalledTimes(2); expect(asset.audioCodec).toBe('aac'); expect((await probe(asset.filePath, true)).audioCodec).toBe('aac')
  expect(ctx.db.select().from(remotePosts).where(eq(remotePosts.id, postId)).get()?.assetId).toBe(asset.id)
})
it('never turns a failed audio download into a successful silent import', async () => {
  vi.mocked(downloadVideo).mockImplementation(async (url, target) => { if (url.includes('audio')) throw new Error('Audio unavailable'); await copyFile(video, target) })
  enqueue(ctx.db, { workspaceId: ws, type: 'download_reel', label: 'Download', payload: { postId, videoUrl: 'https://scontent.cdninstagram.com/video.mp4', audioUrl: 'https://scontent.cdninstagram.com/audio.m4a' } }, ctx.clock())
  await expect(runReelDownload(ctx, leaseNext(ctx.db, ctx.clock(), 60000)!)).rejects.toThrow('Audio unavailable')
  expect(ctx.db.select().from(remotePosts).where(eq(remotePosts.id, postId)).get()?.assetId).toBeNull()
})
