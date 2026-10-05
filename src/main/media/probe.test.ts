import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { probe } from './probe'
import { validateForReels } from './validate'
import { makeTestVideo } from './test-fixtures'
import { AppError } from '@shared/errors'

const dir = mkdtempSync(join(tmpdir(), 'legacy-probe-'))
const video = join(dir, 'v.mp4')

beforeAll(async () => { await makeTestVideo(video) })

describe('probe', () => {
  it('lê dimensões, duração e codecs', async () => {
    const p = await probe(video)
    expect(p).toMatchObject({ width: 360, height: 640, displayWidth: 360, videoCodec: 'mpeg4', audioCodec: 'aac', rotation: 0 })
    expect(p.durationMs).toBeGreaterThanOrEqual(3900)
    expect(validateForReels(p).errors[0]).toMatch(/Codec mpeg4/)
  })
  it('arquivo inválido gera AppError', async () => {
    await expect(probe(join(dir, 'nao-existe.mp4'))).rejects.toBeInstanceOf(AppError)
  })
})
