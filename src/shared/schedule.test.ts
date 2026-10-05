import { describe, it, expect } from 'vitest'
import { zonedToUtc, planSlots } from './schedule'
import { AppError } from './errors'

describe('zonedToUtc', () => {
  it('São Paulo sem horário de verão', () => {
    expect(zonedToUtc('2026-10-05', '09:00', 'America/Sao_Paulo').toISOString()).toBe('2026-10-05T12:00:00.000Z')
  })
  it('horário inexistente avança para o próximo minuto válido', () => {
    expect(zonedToUtc('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:00:00.000Z')
  })
  it('horário repetido usa a primeira ocorrência', () => {
    expect(zonedToUtc('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })
})

describe('planSlots', () => {
  const base = {
    timeZone: 'America/Sao_Paulo',
    windows: [{ start: '09:00', end: '12:00' }],
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    minIntervalMin: 60,
    maxPerDay: 2,
    now: new Date('2026-10-05T00:00:00Z')
  }

  it('distribui respeitando máximo por dia e intervalo', () => {
    const r = planSlots({ ...base, count: 3, startDate: '2026-10-05' })
    expect(r.slots).toEqual(['2026-10-05T12:00:00.000Z', '2026-10-05T13:00:00.000Z', '2026-10-06T12:00:00.000Z'])
    expect(r.unplaced).toBe(0)
  })

  it('pula dias da semana não permitidos', () => {
    const r = planSlots({ ...base, count: 1, startDate: '2026-10-10', weekdays: [1] })
    expect(r.slots).toEqual(['2026-10-12T12:00:00.000Z'])
  })

  it('não agenda no passado', () => {
    const r = planSlots({ ...base, count: 1, startDate: '2026-10-05', now: new Date('2026-10-05T13:30:00Z') })
    expect(r.slots).toEqual(['2026-10-05T14:00:00.000Z'])
  })

  it('informa itens que não cabem até a data final', () => {
    const r = planSlots({ ...base, count: 5, startDate: '2026-10-05', endDate: '2026-10-06' })
    expect(r.slots).toHaveLength(4)
    expect(r.unplaced).toBe(1)
  })

  it('valida intervalo mínimo', () => {
    expect(() => planSlots({ ...base, count: 1, startDate: '2026-10-05', minIntervalMin: 0 })).toThrow(
      new AppError('invalid_input', 'O intervalo mínimo precisa ser de pelo menos 1 minuto.')
    )
  })

  it('valida máximo por dia', () => {
    expect(() => planSlots({ ...base, count: 1, startDate: '2026-10-05', maxPerDay: 0 })).toThrow(
      new AppError('invalid_input', 'O máximo por dia precisa ser pelo menos 1.')
    )
  })
})
