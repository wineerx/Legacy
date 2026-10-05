import { zonedToUtc } from '@shared/schedule'

export const captionFor = (id: string, base: string, overrides: Record<string, string>): string => overrides[id] ?? base

export function buildReminders(count: number, opts: { enabled: boolean; startDate: string; startTime: string; intervalMin: number; timeZone: string; now: Date }): (string | null)[] {
  if (!opts.enabled) return Array.from({ length: count }, () => null)
  const first = zonedToUtc(opts.startDate, opts.startTime, opts.timeZone).getTime()
  return Array.from({ length: count }, (_, i) => new Date(first + i * opts.intervalMin * 60_000).toISOString())
}
