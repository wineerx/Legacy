// Encoders do sistema/GPU primeiro (licenciamento); libopenh264 só como último recurso.
const PREFERENCE = ['h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libopenh264']

export function h264Candidates(encodersOutput: string): string[] {
  const available = new Set(
    encodersOutput.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[1]).filter(Boolean)
  )
  return PREFERENCE.filter((e) => available.has(e))
}

export function pickH264Encoder(encodersOutput: string): string | null {
  return h264Candidates(encodersOutput)[0] ?? null
}
