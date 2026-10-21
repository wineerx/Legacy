import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DistributionPlan } from '@shared/peak-windows'
import type { QuotaProjection } from '@shared/quota'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { DistributionPanel } from './DistributionPanel'
import { PeakWindowsPanel } from '../settings/PeakWindowsPanel'

const all = [0, 1, 2, 3, 4, 5, 6]
const quota = (over: Partial<QuotaProjection> = {}): QuotaProjection => ({ status: 'known', reason: null, snapshot: null, limit: 50, windowSec: 86400,
  breakdown: { official: 0, confirmedAfterSnapshot: 0, uncertainAfterSnapshot: 0, pending: 0, candidates: 48 }, availableNow: 50, slots: [], overLimit: 0, ...over })
const plan = (over: Partial<DistributionPlan> = {}): DistributionPlan => ({ accountId: '111', timeZone: 'America/Sao_Paulo', fromDate: '2026-10-12',
  windows: [{ start: '09:00', end: '12:00', weekdays: all }, { start: '13:00', end: '16:00', weekdays: all }],
  placements: [
    { id: 'a', placed: true, start: '2026-10-12T12:00:00.000Z', end: '2026-10-12T14:45:00.000Z', slots: [], window: 0, date: '2026-10-12', name: 'Container A', count: 12, intervalMin: 15, revision: 1 },
    { id: 'b', placed: false, reason: 'A sequência de 20 vídeo(s) a cada 15 min não cabe em nenhuma janela.', name: 'Container B', count: 20, intervalMin: 15, revision: 3 }],
  quota: quota(), peakInWindow: 48, ...over })

describe('DistributionPanel', () => {
  it('previews times in the Container zone, reasons for unplaced ones and the quota usage with margin; applies only placed drafts', async () => {
    const applied = vi.fn()
    const invoke = mockBridge({ 'containers.distribution.plan': () => plan(), 'containers.distribution.apply': () => plan() })
    renderWithApp(<DistributionPanel workspaceId={WS_ID} containerIds={['a', 'b']} timeZone="America/Sao_Paulo" onApplied={applied} onClose={() => {}} />)
    const region = await screen.findByRole('region', { name: 'Distribuição em horários de pico' })
    expect(await within(region).findByText(/09:00 → .*11:45/)).toBeInTheDocument()
    expect(within(region).getByText(/janela 09:00–12:00 \(Seg\)/)).toBeInTheDocument()
    expect(within(region).getByText('A sequência de 20 vídeo(s) a cada 15 min não cabe em nenhuma janela.')).toBeInTheDocument()
    expect(within(region).getByText('48 / 50')).toBeInTheDocument()
    expect(within(region).getByText(/Margem operacional: 2/)).toBeInTheDocument()
    expect(within(region).getByRole('progressbar', { name: 'Uso previsto da quota' })).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Aplicar horários aos rascunhos' }))
    await waitFor(() => expect(applied).toHaveBeenCalledWith(1))
    expect(invoke).toHaveBeenCalledWith('containers.distribution.apply', { workspaceId: WS_ID, fromDate: expect.any(String), items: [{ containerId: 'a', expectedRevision: 1, start: '2026-10-12T12:00:00.000Z' }] })
  })

  it('unknown quota shows no numbers; a refused apply keeps the panel and recomputes', async () => {
    let calls = 0
    const invoke = mockBridge({ 'containers.distribution.plan': () => { calls++; return plan({ quota: quota({ status: 'unknown', reason: 'Quota ainda não consultada para esta conta.', limit: null, windowSec: null, availableNow: null }), peakInWindow: null }) },
      'containers.distribution.apply': () => { throw { code: 'invalid_input', message: 'A distribuição mudou desde a prévia. Revise os horários novamente.' } } })
    renderWithApp(<DistributionPanel workspaceId={WS_ID} containerIds={['a']} timeZone="America/Sao_Paulo" onApplied={() => {}} onClose={() => {}} />)
    expect(await screen.findByText(/Quota com capacidade desconhecida\. Quota ainda não consultada/)).toBeInTheDocument()
    expect(screen.queryByText(/Margem operacional/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar horários aos rascunhos' }))
    expect(await screen.findByText('A distribuição mudou desde a prévia. Revise os horários novamente.')).toBeInTheDocument()
    await waitFor(() => expect(calls).toBeGreaterThan(1))
    expect(invoke.mock.calls.filter(c => c[0] === 'containers.distribution.apply')).toHaveLength(1)
  })

  it('a planning error (no windows) is shown as the reason, with nothing to apply', async () => {
    mockBridge({ 'containers.distribution.plan': () => { throw { code: 'invalid_input', message: 'Configure as janelas de pico em Configurações antes de distribuir.' } } })
    renderWithApp(<DistributionPanel workspaceId={WS_ID} containerIds={['a']} timeZone="UTC" onApplied={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('Configure as janelas de pico em Configurações antes de distribuir.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aplicar horários aos rascunhos' })).toBeNull()
  })
})

describe('PeakWindowsPanel', () => {
  it('starts empty (no built-in windows), validates overlap locally and saves valid windows', async () => {
    const saved: unknown[] = []
    const invoke = mockBridge({ 'scheduler.windows.get': () => ({ windows: [], timeZone: 'America/Sao_Paulo' }), 'scheduler.windows.save': ({ windows }) => { saved.push(windows); return { windows, timeZone: 'America/Sao_Paulo' } } })
    renderWithApp(<PeakWindowsPanel />)
    expect(await screen.findByText('Nenhuma janela configurada')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar janela' }))
    await userEvent.type(screen.getByLabelText('Início da janela 1'), '2200')
    await userEvent.type(screen.getByLabelText('Fim da janela 1'), '0100')
    expect(await screen.findByText('Atravessa a meia-noite: termina às 01:00 do dia seguinte.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar janela' }))
    await userEvent.type(screen.getByLabelText('Início da janela 2'), '0030')
    await userEvent.type(screen.getByLabelText('Fim da janela 2'), '0200')
    expect(await screen.findByText('As janelas 1 e 2 se sobrepõem.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar janelas' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Remover janela 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar janelas' }))
    await waitFor(() => expect(saved).toEqual([[{ start: '22:00', end: '01:00', weekdays: all }]]))
    expect(invoke).toHaveBeenCalledWith('scheduler.windows.save', { workspaceId: WS_ID, windows: [{ start: '22:00', end: '01:00', weekdays: all }] })
  })
})
