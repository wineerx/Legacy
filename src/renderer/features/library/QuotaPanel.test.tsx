import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QuotaProjection, QuotaSnapshotView } from '@shared/quota'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { QuotaPanel } from './QuotaPanel'

const snapshot = (over: Partial<QuotaSnapshotView> = {}): QuotaSnapshotView => ({ accountId: '111', source: 'instagram.content_publishing_limit', usage: 7, total: 25, durationSec: 7200,
  fetchedAt: '2026-10-10T15:00:00.000Z', attemptedAt: '2026-10-10T15:00:00.000Z', lastStatus: 'ok', errorKind: null, errorMessage: null, freshness: 'fresh', ...over })
const known = (over: Partial<QuotaProjection> = {}): QuotaProjection => ({ status: 'known', reason: null, snapshot: snapshot(), limit: 25, windowSec: 7200,
  breakdown: { official: 7, confirmedAfterSnapshot: 1, uncertainAfterSnapshot: 0, pending: 4, candidates: 3 }, availableNow: 17, slots: [], overLimit: 0, ...over })
const slots = ['2026-10-10T16:00:00.000Z']

describe('QuotaPanel', () => {
  it('shows official usage, local confirmations, reservations, capacity and the time of the reading separately', async () => {
    const invoke = mockBridge({ 'quota.get': () => known() })
    renderWithApp(<QuotaPanel workspaceId={WS_ID} accountId="111" slots={slots} timeZone="America/Sao_Paulo" />)
    expect(await screen.findByText('7 de 25 em 2 h')).toBeInTheDocument()
    expect(screen.getByText('Capacidade agora (estimativa)').nextSibling).toHaveTextContent('17')
    expect(screen.getByText('Já agendadas nesta conta').nextSibling).toHaveTextContent('4')
    expect(screen.getByText('Este Container').nextSibling).toHaveTextContent('3')
    expect(screen.getByText(/Última consulta: 10\/10\/2026, 12:00/)).toBeInTheDocument()
    expect(screen.getByText('Atualizada')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('quota.get', { workspaceId: WS_ID, accountId: '111', slots })
    expect(invoke.mock.calls.some(c => c[0] === 'quota.refresh')).toBe(false)
  })

  it('warns which items of this Container and which scheduled ones exceed the limit', async () => {
    mockBridge({ 'quota.get': () => known({ overLimit: 2, slots: [{ at: '2026-10-10T16:00:00.000Z', candidate: true, inWindow: 26, withinLimit: false }, { at: '2026-10-10T17:00:00.000Z', jobId: 'j', candidate: false, inWindow: 26, withinLimit: false }] }) })
    renderWithApp(<QuotaPanel workspaceId={WS_ID} accountId="111" slots={slots} timeZone="America/Sao_Paulo" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('1 publicação(ões) deste Container excedem a quota informada; a primeira em 10/10/2026, 13:00. 1 publicação(ões) já agendada(s) ficariam além da quota.')
  })

  it('stale reading: capacity unknown, last valid values kept, refreshed once automatically', async () => {
    const stale = { ...known(), status: 'unknown' as const, reason: 'A última leitura válida está desatualizada. Atualize a quota para estimar a capacidade.', availableNow: null, snapshot: snapshot({ freshness: 'stale' }) }
    const invoke = mockBridge({ 'quota.get': () => stale, 'quota.refresh': () => known() })
    renderWithApp(<QuotaPanel workspaceId={WS_ID} accountId="111" slots={slots} timeZone="UTC" />)
    await waitFor(() => expect(invoke.mock.calls.filter(c => c[0] === 'quota.refresh')).toHaveLength(1))
    expect(await screen.findByText('7 de 25 em 2 h')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar quota' }))
    await waitFor(() => expect(invoke.mock.calls.filter(c => c[0] === 'quota.refresh')).toHaveLength(2))
  })

  it('failed reading without any valid value shows unknown capacity, the cause and dashes, never a number', async () => {
    const failed = snapshot({ usage: null, total: null, durationSec: null, fetchedAt: null, lastStatus: 'error', errorKind: 'permission', errorMessage: 'A Meta recusou a consulta de quota. Reconecte a conta com instagram_business_content_publish.', freshness: 'missing' })
    const unknown = { ...known(), status: 'unknown' as const, reason: 'A consulta de quota falhou e não há leitura válida.', availableNow: null, limit: null, windowSec: null, snapshot: failed }
    mockBridge({ 'quota.get': () => unknown, 'quota.refresh': () => unknown })
    renderWithApp(<QuotaPanel workspaceId={WS_ID} accountId="111" slots={[]} timeZone="UTC" />)
    expect(await screen.findByText(/Capacidade desconhecida\. A consulta de quota falhou/)).toBeInTheDocument()
    expect(screen.getByText(/Reconecte a conta com instagram_business_content_publish/)).toBeInTheDocument()
    expect(screen.getByText('Indisponível')).toBeInTheDocument()
    expect(screen.queryByText('Consumo informado pela Meta')).toBeNull()
  })

  it('IPC failure has an error state with retry', async () => {
    let fail = true
    mockBridge({ 'quota.get': () => { if (fail) throw { code: 'internal', message: 'x' }; return known() } })
    renderWithApp(<QuotaPanel workspaceId={WS_ID} accountId="111" slots={slots} timeZone="UTC" />)
    expect(await screen.findByText(/Não foi possível calcular a quota/)).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('7 de 25 em 2 h')).toBeInTheDocument()
  })
})
