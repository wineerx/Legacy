import { describe, expect, it } from 'vitest'
import { streakFor } from './achievements'
describe('ofensiva por dias locais', () => {
  it('conta um único dia por múltiplas publicações e mantém até ontem', () => {
    expect(streakFor(['2026-10-03T12:00:00Z', '2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z'], new Date('2026-10-05T12:00:00Z'), 'America/Sao_Paulo')).toEqual({ current: 2, best: 2, today: false })
  })
  it('reinicia após dia sem publicação, conservando recorde', () => {
    expect(streakFor(['2026-10-01T12:00:00Z', '2026-10-02T12:00:00Z', '2026-10-03T12:00:00Z'], new Date('2026-10-05T12:00:00Z'), 'UTC')).toEqual({ current: 0, best: 3, today: false })
  })
  it('usa meia-noite do workspace e não UTC', () => {
    expect(streakFor(['2026-10-05T01:00:00Z'], new Date('2026-10-05T02:00:00Z'), 'America/Sao_Paulo')).toEqual({ current: 1, best: 1, today: true })
  })
  it('não cria ofensiva sem confirmação', () => expect(streakFor([], new Date(), 'UTC')).toEqual({ current: 0, best: 0, today: false }))
})
