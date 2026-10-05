import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'
import { mergeAudio } from './ops'
import { probe } from './probe'
it('muxes actual separate streams into H264/AAC without discarding original audio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'legacy-audio-'))
  try {
    const video = join(root, 'video.mp4'), audio = join(root, 'audio.m4a'), output = join(root, 'output.mp4')
    await runTool(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=4', '-c:v', 'libopenh264', video])
    await runTool(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'aac', audio])
    expect((await probe(video, true)).audioCodec).toBeNull()
    await mergeAudio(video, audio, output)
    expect(await probe(output, true)).toMatchObject({ videoCodec: 'h264', audioCodec: 'aac', durationMs: 4000 })
    const decoded = await runTool(ffmpegPaths().ffmpeg, ['-v', 'error', '-i', output, '-map', '0:a:0', '-f', 'null', '-'])
    expect(decoded.stderr).toBe('')
  } finally { await rm(root, { recursive: true, force: true }) }
})
