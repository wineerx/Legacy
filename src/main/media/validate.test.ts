import { describe, it, expect } from 'vitest'
import { validateForReels } from './validate'
import type { ProbeResult } from './probe'

const ok: ProbeResult = { durationMs: 30_000, width: 1080, height: 1920, displayWidth: 1080, displayHeight: 1920, videoCodec: 'h264', audioCodec: 'aac', sizeBytes: 50_000_000, rotation: 0 }

describe('validateForReels', () => {
  it('aceita 1080x1920 h264 30s', () => {
    expect(validateForReels(ok)).toEqual({ ok: true, errors: [], warnings: [] })
  })
  it('erro de duração curta e longa', () => {
    expect(validateForReels({ ...ok, durationMs: 2000 }).errors).toContain('Duração abaixo de 3 s.')
    expect(validateForReels({ ...ok, durationMs: 91_000 }).errors).toContain('Duração acima de 90 s.')
  })
  it('erro de codec', () => {
    expect(validateForReels({ ...ok, videoCodec: 'vp9' }).ok).toBe(false)
  })
  it('erro de tamanho', () => {
    expect(validateForReels({ ...ok, sizeBytes: 1024 ** 3 + 1 }).errors).toContain('Arquivo acima de 1 GB.')
  })
  it('aviso de proporção e resolução', () => {
    const v = validateForReels({ ...ok, width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 })
    expect(v.ok).toBe(true)
    expect(v.warnings).toContain('Proporção diferente de 9:16. O vídeo pode ser cortado.')
    expect(validateForReels({ ...ok, width: 540, height: 960, displayWidth: 540, displayHeight: 960 }).warnings)
      .toContain('Resolução abaixo de 720 px de largura.')
  })
})
