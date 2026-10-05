const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

function oneDecimal(value: number): string {
  const truncated = Math.floor(value * 10) / 10
  return truncated % 1 === 0 ? String(truncated) : truncated.toFixed(1).replace('.', ',')
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (n < 10_000) return int.format(n)
  if (n < 100_000) return `${oneDecimal(n / 1000)} mil`
  if (n < 1_000_000) return `${Math.floor(n / 1000)} mil`
  if (n < 1_000_000_000) return `${oneDecimal(n / 1_000_000)} mi`
  return `${oneDecimal(n / 1_000_000_000)} bi`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
