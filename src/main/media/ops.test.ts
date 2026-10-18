import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeTestVideo } from './test-fixtures'
import { extractFrame, makeThumbnail, stripMetadata, overlayBanner, renderVideoVersion, detectH264Encoder } from './ops'
import { AppError } from '@shared/errors'
import { probe } from './probe'
import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'

const dir = mkdtempSync(join(tmpdir(), 'legacy-ops-'))
const video = join(dir, 'in.mp4')

async function formatTags(file: string): Promise<Record<string, string>> {
  const { stdout } = await runTool(ffmpegPaths().ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', file])
  return (JSON.parse(stdout).format.tags ?? {}) as Record<string, string>
}

beforeAll(async () => { await makeTestVideo(video) })

describe('ops', () => {
  it('extractFrame gera PNG redimensionado', async () => {
    const out = join(dir, 'f.png')
    await extractFrame(video, 1000, out, 180)
    const p = await probe(out).catch(() => null)
    expect(existsSync(out)).toBe(true)
    expect(p?.width).toBe(180)
  })

  it('makeThumbnail gera JPEG', async () => {
    const out = join(dir, 't.jpg')
    await makeThumbnail(video, out, 4000)
    expect(statSync(out).size).toBeGreaterThan(0)
  })

  it('stripMetadata remove localização e título, mantém streams', async () => {
    expect((await formatTags(video)).location).toBeDefined()
    const out = join(dir, 's.mp4')
    await stripMetadata(video, out)
    const tags = await formatTags(out)
    expect(tags.location).toBeUndefined()
    expect(tags.title).toBeUndefined()
    const p = await probe(out)
    expect(p).toMatchObject({ width: 360, height: 640, audioCodec: 'aac' })
  })

  it('overlayBanner mantém duração e dimensões', async (ctx) => {
    const encoder = await detectH264Encoder().catch(() => null)
    if (!encoder) ctx.skip()
    const banner = join(dir, 'banner.png')
    await runTool(ffmpegPaths().ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=360x640,format=rgba', '-frames:v', '1', banner])
    const out = join(dir, 'b.mp4')
    await overlayBanner(video, banner, out, { startMs: 500, endMs: 2500 })
    const p = await probe(out)
    expect(p.audioCodec).toBe('aac')
    expect(p.width).toBe(360)
    expect(p.videoCodec).toBe('h264')
    expect(Math.abs(p.durationMs - 4000)).toBeLessThan(100)
    const pixel = join(dir, 'banner-first.rgb')
    await runTool(ffmpegPaths().ffmpeg, ['-y', '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', pixel])
    const [r,g,b] = readFileSync(pixel)
    expect(r).toBeGreaterThan(g + b)
  })

  it('renderVideoVersion insere a capa como primeiro frame e mantém o áudio', async (ctx) => {
    const encoder = await detectH264Encoder().catch(() => null)
    if (!encoder) ctx.skip()
    const cover = join(dir, 'capa.png')
    await runTool(ffmpegPaths().ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=540x960', '-frames:v', '1', cover])
    const out = join(dir, 'c.mp4')
    await renderVideoVersion(video, out, { coverPng: cover })
    const p = await probe(out)
    expect(p).toMatchObject({ width: 360, height: 640, videoCodec: 'h264', audioCodec: 'aac' })
    expect(Math.abs(p.durationMs - 4033)).toBeLessThan(300)
    const pixel = join(dir, 'pixel.rgb')
    await runTool(ffmpegPaths().ffmpeg, ['-y', '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', pixel])
    const [r, g, b] = readFileSync(pixel)
    expect(r).toBeGreaterThan(180)
    expect(g + b).toBeLessThan(120)
  })

  it('detectH264Encoder valida com encode de teste', async () => {
    const enc = await detectH264Encoder()
    expect(['h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libopenh264']).toContain(enc)
  })

  it('overlayBanner rejeita janela inválida', async () => {
    await expect(overlayBanner(video, video, join(dir, 'x.mp4'), { startMs: NaN, endMs: 1000 })).rejects.toBeInstanceOf(AppError)
  })
})
