import { zonedToUtc } from '@shared/schedule'

export const captionFor = (
  id: string,
  base: string,
  overrides: Record<string, string>
): string => overrides[id] ?? base

export function buildReminders(
  count: number,
  opts: {
    enabled: boolean
    startDate: string
    startTime: string
    intervalMin: number
    timeZone: string
    now: Date
  }
): (string | null)[] {
  if (!opts.enabled) return Array.from({ length: count }, () => null)
  const interval = count > 1 ? opts.intervalMin : 60
  const empty = () => Array.from({ length: count }, () => null)
  if (!opts.startDate || !opts.startTime || !Number.isFinite(interval))
    return empty()
  try {
    const first = zonedToUtc(
      opts.startDate,
      opts.startTime,
      opts.timeZone
    ).getTime()
    return Array.from({ length: count }, (_, i) =>
      new Date(first + i * interval * 60_000).toISOString()
    )
  } catch {
    return empty()
  }
}
