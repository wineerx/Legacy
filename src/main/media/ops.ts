import { AppError } from '@shared/errors'
import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'
import { h264Candidates } from './encoders'
import { probe } from './probe'

const ff = (args: string[], timeoutMs?: number) => runTool(ffmpegPaths().ffmpeg, ['-y', '-hide_banner', '-v', 'error', ...args], { timeoutMs })
const seconds = (ms: number) => (ms / 1000).toFixed(3)

export async function extractFrame(input: string, atMs: number, outPng: string, width?: number): Promise<void> {
  const vf = width ? ['-vf', `scale=${width}:-2`] : []
  await ff(['-ss', seconds(atMs), '-i', input, '-frames:v', '1', ...vf, outPng], 60_000)
}

export async function makeThumbnail(input: string, outJpg: string, durationMs: number): Promise<void> {
  const at = Math.max(500, Math.floor(durationMs * 0.1))
  await ff(['-ss', seconds(at), '-i', input, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', outJpg], 60_000)
}

export async function stripMetadata(input: string, out: string): Promise<void> {
  await ff(['-i', input, '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', out])
}

let cachedEncoder: string | null = null

export async function detectH264Encoder(): Promise<string> {
  if (cachedEncoder) return cachedEncoder
  const { stdout } = await runTool(ffmpegPaths().ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 30_000 })
  for (const enc of h264Candidates(stdout)) {
    try {
      await runTool(ffmpegPaths().ffmpeg, [
        '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=128x128:d=0.2',
        '-frames:v', '3', ...encoderArgs(enc), '-f', 'null', '-'
      ], { timeoutMs: 15_000 })
      cachedEncoder = enc
      return enc
    } catch {
      // encoder listado mas não inicializa neste computador; tenta o próximo
    }
  }
  throw new AppError('ffmpeg_failed', 'Nenhum encoder H.264 disponível neste computador. Atualize o driver de vídeo ou o Windows.')
}

function encoderArgs(encoder: string, bitrate = '8M'): string[] {
  if (encoder === 'libopenh264') return ['-c:v', encoder, '-b:v', bitrate]
  if (encoder === 'h264_mf') return ['-c:v', encoder, '-b:v', bitrate, '-rate_control', 'cbr']
  return ['-c:v', encoder, '-b:v', bitrate]
}

export type BannerWindow = { startMs: number; endMs: number }

function assertWindow(window: BannerWindow): void {
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.startMs < 0) throw new AppError('invalid_input', 'O intervalo do banner é inválido.')
  if (window.endMs <= window.startMs) throw new AppError('invalid_input', 'O fim do banner precisa ser depois do início.')
}

/** Duração do frame de capa inserido antes do vídeo: um quadro a 30 fps, imperceptível na reprodução. */
export const COVER_FRAME_MS = 33

/**
 * Gera a versão editada em uma única codificação: banner sobreposto no intervalo pedido e,
 * opcionalmente, a capa como primeiro frame. O primeiro frame contém a capa/banner e pode ser escolhido como miniatura
 * pela plataforma; a API Instagram recebe thumb_offset=0 para essa referência.
 */
export async function renderVideoVersion(input: string, out: string, opts: { banner?: { png: string; window: BannerWindow }; coverPng?: string }): Promise<void> {
  if (!opts.banner && !opts.coverPng) throw new AppError('invalid_input', 'Nada a aplicar no vídeo.')
  if (opts.banner) assertWindow(opts.banner.window)
  const p = await probe(input)
  const encoder = await detectH264Encoder()
  const w = p.displayWidth, h = p.displayHeight
  const args = ['-i', input]
  const chains: string[] = []
  let main = '[0:v]'
  let next = 1
  if (opts.banner) {
    args.push('-i', opts.banner.png)
    const b = `[${next++}:v]`
    const { startMs, endMs } = opts.banner.window
    chains.push(`${b}scale=${w}:${h}[bn]`, `${main}[bn]overlay=0:0:enable='eq(n,0)+between(t,${seconds(startMs)},${seconds(endMs)})'[ov]`)
    main = '[ov]'
  }
  chains.push(`${main}scale=${w}:${h},setsar=1,format=yuv420p[main]`)
  let video = '[main]'
  if (opts.coverPng) {
    args.push('-loop', '1', '-framerate', '30', '-t', '0.2', '-i', opts.coverPng)
    const c = `[${next++}:v]`
    chains.push(`${c}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,format=yuv420p,trim=end_frame=1,setpts=PTS-STARTPTS[cover]`, `[cover][main]concat=n=2:v=1:a=0[v]`)
    video = '[v]'
  }
  const audio = p.audioCodec
    ? opts.coverPng
      ? ['-filter_complex', `${chains.join(';')};[0:a]adelay=delays=${COVER_FRAME_MS}:all=1[a]`, '-map', video, '-map', '[a]', '-c:a', 'aac', '-b:a', '192k']
      : ['-filter_complex', chains.join(';'), '-map', video, '-map', '0:a', '-c:a', 'copy']
    : ['-filter_complex', chains.join(';'), '-map', video]
  await ff([...args, ...audio, ...encoderArgs(encoder, String(Math.max(8_000_000, Math.ceil(p.sizeBytes * 8 / Math.max(0.001, p.durationMs / 1000))))), '-fps_mode', 'vfr', '-map_metadata', '0', '-movflags', '+faststart', out])
}

export async function overlayBanner(input: string, bannerPng: string, out: string, window: BannerWindow): Promise<void> {
  assertWindow(window)
  await renderVideoVersion(input, out, { banner: { png: bannerPng, window } })
}

export async function mergeAudio(video: string, audio: string, out: string): Promise<void> {
  const duration = (await probe(video, true)).durationMs
  await ff(['-protocol_whitelist', 'file', '-i', video, '-protocol_whitelist', 'file', '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-t', seconds(duration), '-movflags', '+faststart', out])
  if (!(await probe(out, true)).audioCodec) throw new AppError('invalid_media', 'A faixa de áudio não foi preservada.')
}
