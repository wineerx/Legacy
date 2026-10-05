import { stat } from 'node:fs/promises'
import { AppError } from '@shared/errors'
import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'

export interface ProbeResult {
  durationMs: number; width: number; height: number; displayWidth: number; displayHeight: number
  videoCodec: string; audioCodec: string | null; sizeBytes: number; rotation: number
}

interface FfStream {
  codec_type: string; codec_name: string; width?: number; height?: number
  tags?: { rotate?: string }; side_data_list?: { rotation?: number }[]
}

export async function probe(file: string, videoContainerOnly = false): Promise<ProbeResult> {
  const { stdout } = await runTool(ffmpegPaths().ffprobe, [
    '-v', 'error', '-protocol_whitelist', 'file', ...(videoContainerOnly ? ['-format_whitelist', 'mov'] : []), '-print_format', 'json', '-show_format', '-show_streams', file
  ], { timeoutMs: 60_000 })
  const data = JSON.parse(stdout) as { streams: FfStream[]; format: { duration?: string } }
  const video = data.streams.find((s) => s.codec_type === 'video')
  if (!video?.width || !video.height) throw new AppError('invalid_media', 'O arquivo não tem faixa de vídeo.')
  const audio = data.streams.find((s) => s.codec_type === 'audio')
  const rawRotation = video.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? Number(video.tags?.rotate ?? 0)
  const rotation = ((Math.round(rawRotation) % 360) + 360) % 360
  const swap = rotation === 90 || rotation === 270
  return {
    durationMs: Math.round(Number(data.format.duration ?? 0) * 1000),
    width: video.width, height: video.height,
    displayWidth: swap ? video.height : video.width,
    displayHeight: swap ? video.width : video.height,
    videoCodec: video.codec_name, audioCodec: audio?.codec_name ?? null,
    sizeBytes: (await stat(file)).size, rotation
  }
}
