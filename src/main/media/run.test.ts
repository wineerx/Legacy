import { describe, it, expect } from 'vitest'
import { runTool } from './run'
import { ffmpegPaths } from './ffmpeg-bin'

describe('runTool', () => {
  it('estouro de tempo gera mensagem de limite', async () => {
    await expect(runTool(ffmpegPaths().ffmpeg, [
      '-hide_banner', '-re', '-f', 'lavfi', '-i', 'testsrc2=duration=60', '-f', 'null', '-'
    ], { timeoutMs: 300 })).rejects.toThrow(/tempo limite/)
  })
})
