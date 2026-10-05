import type { ProbeResult } from './probe'

export interface Validation { ok: boolean; errors: string[]; warnings: string[] }

export function validateForReels(p: ProbeResult): Validation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!['h264', 'hevc'].includes(p.videoCodec)) errors.push(`Codec ${p.videoCodec} não aceito. Use H.264 ou HEVC.`)
  if (p.durationMs < 3000) errors.push('Duração abaixo de 3 s.')
  if (p.durationMs > 90_000) errors.push('Duração acima de 90 s.')
  if (p.sizeBytes > 1024 ** 3) errors.push('Arquivo acima de 1 GB.')
  const ratio = p.displayWidth / p.displayHeight
  if (Math.abs(ratio - 9 / 16) / (9 / 16) > 0.01) warnings.push('Proporção diferente de 9:16. O vídeo pode ser cortado.')
  if (p.displayWidth < 720) warnings.push('Resolução abaixo de 720 px de largura.')
  return { ok: errors.length === 0, errors, warnings }
}
