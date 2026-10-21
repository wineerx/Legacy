import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ContainerWindowView } from '@shared/container-window'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { ContainerWindowPanel } from './ContainerWindowPanel'

const ID = '705e4d11-07c3-424a-8dce-7b3107f030f9'
const view = (over: Partial<ContainerWindowView['window']> = {}, extra: Partial<ContainerWindowView> = {}): ContainerWindowView => ({
  containerId: ID, revision: 4, timeZone: 'America/Sao_Paulo',
  window: { status: 'late', plannedStartAt: '2026-10-12T16:00:00.000Z', plannedEndAt: '2026-10-12T18:45:00.000Z', intervalMin: 15, estimatedEndAt: '2026-10-12T19:07:00.000Z', delayMin: 22,
    published: 8, remaining: 4, inFlight: 1, failed: 0, overdue: 2, quotaConsidered: true, estimate: [], ...over },
  proposals: { proposals: [{ kind: 'keep', estimatedEndAt: '2026-10-12T19:07:00.000Z', delayMin: 22 },
    { kind: 'move', slots: [{ jobId: 'j9', at: '2026-10-12T21:00:00.000Z' }], startAt: '2026-10-12T21:00:00.000Z', estimatedEndAt: '2026-10-12T21:45:00.000Z', window: { start: '18:00', end: '21:00', weekdays: [1] } }],
    unavailable: [{ kind: 'reduce', reason: 'O intervalo já está no mínimo de 15 min.' }] },
  quota: { total: 50, available: 10, fetchedAt: '2026-10-12T17:50:00.000Z', freshness: 'fresh' }, adjustments: [], ...extra })

describe('ContainerWindowPanel', () => {
  it('shows planned window, progress, estimate, delay alert, overdue and in-flight notes, and unavailable reasons', async () => {
    mockBridge({ 'containers.window.get': () => view() })
    renderWithApp(<ContainerWindowPanel workspaceId={WS_ID} containerId={ID} name="Container #25" onBack={() => {}} />)
    expect(await screen.findByText('12/10, 13:00 → 12/10, 15:45')).toBeInTheDocument()
    expect(screen.getByText('8 de 12')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('O Container ultrapassará sua janela em 22 min.')
    expect(screen.getByText('2 vídeo(s) com horário vencido aguardando o processador.')).toBeInTheDocument()
    expect(screen.getByText('1 vídeo(s) em envio não são alterados por ajustes.')).toBeInTheDocument()
    expect(screen.getByText('Reduzir intervalo: O intervalo já está no mínimo de 15 min.')).toBeInTheDocument()
    expect(screen.getByText(/considera a quota informada pela Meta \(consulta de 12\/10, 14:50\)/)).toBeInTheDocument()
  })

  it('nothing changes until the user confirms; the confirmed choice sends the reviewed slots and revision', async () => {
    const invoke = mockBridge({ 'containers.window.get': () => view(), 'containers.window.adjust': () => view({ status: 'on_time', delayMin: 0 }, { proposals: { proposals: [], unavailable: [] } }) })
    renderWithApp(<ContainerWindowPanel workspaceId={WS_ID} containerId={ID} name="C" onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Mover restante' }))
    expect(invoke.mock.calls.some(c => c[0] === 'containers.window.adjust')).toBe(false)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('O fim planejado passa a ser esse horário.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar ajuste' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('containers.window.adjust', { workspaceId: WS_ID, containerId: ID, expectedRevision: 4, kind: 'move', slots: [{ jobId: 'j9', at: '2026-10-12T21:00:00.000Z' }] }))
    expect(await screen.findByText('Ajuste aplicado aos vídeos ainda não enviados. Os demais seguem como estavam.')).toBeInTheDocument()
    expect(screen.getByText('Dentro da janela')).toBeInTheDocument()
  })

  it('paused suspends the estimate and offers nothing; a refused adjustment keeps the dialog with the reason', async () => {
    mockBridge({ 'containers.window.get': () => view({ status: 'paused', estimatedEndAt: null, delayMin: null }, { proposals: { proposals: [], unavailable: [] } }) })
    renderWithApp(<ContainerWindowPanel workspaceId={WS_ID} containerId={ID} name="C" onBack={() => {}} />)
    expect(await screen.findByText('Suspenso durante a pausa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manter intervalo' })).toBeNull()
  })

  it('a refused adjustment explains why and refreshes the window', async () => {
    let reads = 0
    mockBridge({ 'containers.window.get': () => { reads++; return view() }, 'containers.window.adjust': () => { throw { code: 'invalid_input', message: 'Os horários mudaram desde a prévia. Revise a janela novamente.' } } })
    renderWithApp(<ContainerWindowPanel workspaceId={WS_ID} containerId={ID} name="C" onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Manter intervalo' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar ajuste' }))
    expect(await screen.findByText('Os horários mudaram desde a prévia. Revise a janela novamente.')).toBeInTheDocument()
    await waitFor(() => expect(reads).toBeGreaterThan(1))
  })
})
