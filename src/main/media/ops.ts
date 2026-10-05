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

function encoderArgs(encoder: string): string[] {
  if (encoder === 'libopenh264') return ['-c:v', encoder, '-b:v', '8M']
  if (encoder === 'h264_mf') return ['-c:v', encoder, '-b:v', '8M', '-rate_control', 'cbr']
  return ['-c:v', encoder, '-b:v', '8M']
}

export async function overlayBanner(input: string, bannerPng: string, out: string, window: { startMs: number; endMs: number }): Promise<void> {
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.startMs < 0) throw new AppError('invalid_input', 'O intervalo do banner é inválido.')
  if (window.endMs <= window.startMs) throw new AppError('invalid_input', 'O fim do banner precisa ser depois do início.')
  const p = await probe(input)
  const encoder = await detectH264Encoder()
  const filter =
    `[1:v]scale=${p.displayWidth}:${p.displayHeight}[b];` +
    `[0:v][b]overlay=0:0:enable='between(t,${seconds(window.startMs)},${seconds(window.endMs)})',format=yuv420p[v]`
  await ff([
    '-i', input, '-i', bannerPng, '-filter_complex', filter,
    '-map', '[v]', '-map', '0:a?', ...encoderArgs(encoder), '-c:a', 'copy',
    '-map_metadata', '0', '-movflags', '+faststart', out
  ])
}

export async function mergeAudio(video: string, audio: string, out: string): Promise<void> {
  const duration = (await probe(video, true)).durationMs
  await ff(['-protocol_whitelist', 'file', '-i', video, '-protocol_whitelist', 'file', '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-t', seconds(duration), '-movflags', '+faststart', out])
  if (!(await probe(out, true)).audioCodec) throw new AppError('invalid_media', 'A faixa de áudio não foi preservada.')
}
