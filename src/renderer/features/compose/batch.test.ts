import { describe, it, expect } from 'vitest'
import { captionFor, buildReminders } from './batch'

describe('captionFor', () => {
  it('usa sobrescrita quando existe', () => {
    expect(captionFor('a', 'base', { a: 'própria' })).toBe('própria')
    expect(captionFor('b', 'base', { a: 'própria' })).toBe('base')
  })
})

describe('buildReminders', () => {
  const opts = { enabled: true, startDate: '2026-10-05', startTime: '09:00', intervalMin: 120, timeZone: 'America/Sao_Paulo', now: new Date('2026-10-05T00:00:00Z') }
  it('desligado devolve nulls', () => {
    expect(buildReminders(2, { ...opts, enabled: false })).toEqual([null, null])
  })
  it('campos vazios não quebram a prévia e um vídeo ignora intervalo oculto', () => {
    expect(buildReminders(2, { ...opts, intervalMin: NaN })).toEqual([null, null])
    expect(buildReminders(2, { ...opts, startDate: '' })).toEqual([null, null])
    expect(buildReminders(1, { ...opts, intervalMin: NaN })).toEqual(['2026-10-05T12:00:00.000Z'])
  })
  it('espaça pelo intervalo no fuso', () => {
    expect(buildReminders(3, opts)).toEqual(['2026-10-05T12:00:00.000Z', '2026-10-05T14:00:00.000Z', '2026-10-05T16:00:00.000Z'])
  })
})
