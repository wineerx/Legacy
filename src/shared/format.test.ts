import { describe, it, expect } from 'vitest'
import { formatCompact, formatDuration } from './format'

describe('formatCompact', () => {
  it.each([
    [null, '—'], [undefined, '—'], [0, '0'], [999, '999'], [1203, '1.203'], [9999, '9.999'],
    [10000, '10 mil'], [12590, '12,5 mil'], [84000, '84 mil'], [99999, '99,9 mil'],
    [640000, '640 mil'], [999999, '999 mil'], [1_000_000, '1 mi'], [1_299_000, '1,2 mi'],
    [12_400_000, '12,4 mi'], [2_000_000_000, '2 bi']
  ])('%s → %s', (n, out) => {
    expect(formatCompact(n as number | null | undefined)).toBe(out)
  })
})

describe('formatDuration', () => {
  it.each([[null, '—'], [0, '0:00'], [42_000, '0:42'], [65_400, '1:05'], [3_903_000, '1:05:03']])('%s → %s', (ms, out) => {
    expect(formatDuration(ms as number | null)).toBe(out)
  })
})
