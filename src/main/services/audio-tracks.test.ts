import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { defaultAudio, type ContainerVisualSnapshot } from '@shared/container-visual'
import { memDb } from '../test-utils'
import type { Ctx } from '../context'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { jobs } from '../db/schema'
import { runTool } from '../media/run'
import { ffmpegPaths } from '../media/ffmpeg-bin'
import { probe } from '../media/probe'
import { createContainer, scheduleContainer } from './publication-containers'
import { materializeVersion } from './versions'
import { connectInstagram } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { audioTrackPath, importAudioTrack, listAudioTracks } from './audio-tracks'

const fixtures = mkdtempSync(join(tmpdir(), 'legacy-audio-fixtures-'))
const silent = join(fixtures, 'silent.mp4'), voiced = join(fixtures, 'voiced.mp4'), track = join(fixtures, 'track.wav')
let ctx: Ctx, ws: string, revision: string, root: string
const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
const ff = (args: string[]) => runTool(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', ...args])
const volume = async (file: string) => {
  const { stderr } = await runTool(ffmpegPaths().ffmpeg, ['-hide_banner', '-i', file, '-map', '0:a', '-af', 'volumedetect', '-f', 'null', '-'])
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)?.[1])
}
beforeAll(async () => {
  await ff(['-f', 'lavfi', '-i', 'color=black:s=360x640:r=30:d=3', '-c:v', 'mpeg4', silent])
  await ff(['-f', 'lavfi', '-i', 'color=black:s=360x640:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', voiced])
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', track])
})
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legacy-audio-'))
  ctx = { db: memDb(), dataRoot: root, clock: () => new Date('2026-10-09T15:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'Áudio QA', timeZone: 'UTC' }).id
  ctx.secret = (workspace, key) => decryptSecret(ctx, vault, workspace, key)
  revision = (await connectInstagram(ctx, vault, ws, 'synthetic', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'qa' }))).revision
  for (const [id, file] of [['silent', silent], ['voiced', voiced], ['voiced2', voiced]]) insertAsset(ctx.db, { id, workspaceId: ws, origin: 'pc', sourceName: `${id}.mp4`, filePath: file, sha256: id, sizeBytes: readFileSync(file).length, durationMs: 3000, width: 360, height: 640, videoCodec: 'mpeg4', validationJson: '{}', importedAt: ctx.clock().toISOString() })
})
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
afterAll(() => rmSync(fixtures, { recursive: true, force: true }))

async function scheduled(assetId: string, audio: Partial<NonNullable<ContainerVisualSnapshot['audio']>>, plannedStartAt = '2026-10-09T16:00:00Z') {
  const t = await importAudioTrack(ctx, ws, track)
  const visualSnapshot: ContainerVisualSnapshot = { version: 1, audio: { ...defaultAudio(), enabled: true, sha256: t.sha256, ext: t.ext, name: t.name, ...audio } }
  const d = createContainer(ctx, ws, randomUUID(), { name: 'Áudio', provider: 'instagram', destinationAccountId: '111', accountRevision: revision, plannedStartAt, intervalMin: 15, trialGraduation: 'MANUAL', visualSnapshot, items: [{ assetId, captionOverride: 'Legenda própria' }] })
  const result = scheduleContainer(ctx, ws, d.container.id, d.container.revision)
  const payload = JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, result.jobs[0].id)).get()!.payloadJson)
  return { payload, track: t }
}

it('imports a track once by content and rejects files without audio or unknown types', async () => {
  const a = await importAudioTrack(ctx, ws, track), b = await importAudioTrack(ctx, ws, track)
  expect(b).toEqual(a)
  expect(a).toMatchObject({ ext: 'wav', name: 'track.wav', durationMs: 1000 })
  expect(readFileSync(audioTrackPath(ctx, ws, a.sha256, 'wav'))).toEqual(readFileSync(track))
  expect(await listAudioTracks(ctx, ws)).toEqual([a])
  await expect(importAudioTrack(ctx, ws, silent.replace('.mp4', '.mp3'))).rejects.toThrow(/não encontrado/)
  const txt = join(fixtures, 'notes.txt'); writeFileSync(txt, 'x')
  await expect(importAudioTrack(ctx, ws, txt)).rejects.toThrow(/MP3, M4A/)
})
it('replaces the sound of a silent video, keeps its length and freezes caption and trial reel', async () => {
  const original = readFileSync(silent)
  const { payload } = await scheduled('silent', { mode: 'replace' })
  expect(payload).toMatchObject({ caption: 'Legenda própria', trialGraduation: 'MANUAL' })
  const out = await materializeVersion(ctx, ws, 'silent', payload.versionId)
  const p = await probe(out, true)
  expect(p.audioCodec).toBe('aac')
  expect(Math.abs(p.durationMs - 3000)).toBeLessThan(150)
  expect(readFileSync(silent)).toEqual(original)
})
it('mix keeps the original sound under the track; replace at zero volume is silent', async () => {
  const mixed = await materializeVersion(ctx, ws, 'voiced', (await scheduled('voiced', { mode: 'mix', volumePct: 30, originalVolumePct: 100 })).payload.versionId)
  const muted = await materializeVersion(ctx, ws, 'voiced2', (await scheduled('voiced2', { mode: 'replace', volumePct: 0 }, '2026-10-09T18:00:00Z')).payload.versionId)
  expect(await volume(mixed)).toBeGreaterThan(-40)
  expect(await volume(muted)).toBeLessThan(-80)
})
it('refuses to publish when the imported track changed after scheduling', async () => {
  const { payload, track: t } = await scheduled('silent', { mode: 'replace' })
  writeFileSync(audioTrackPath(ctx, ws, t.sha256, t.ext), 'tampered')
  await expect(materializeVersion(ctx, ws, 'silent', payload.versionId)).rejects.toThrow(/faixa de áudio mudou/)
})
