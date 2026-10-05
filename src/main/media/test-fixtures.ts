import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'

export async function makeTestVideo(out: string, opts: { width?: number; height?: number; seconds?: number } = {}): Promise<void> {
  const { width = 360, height = 640, seconds = 4 } = opts
  await runTool(ffmpegPaths().ffmpeg, [
    '-y', '-hide_banner', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-metadata', 'location=+12.3456-045.6789/', '-metadata', 'title=teste',
    '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', out
  ])
}
