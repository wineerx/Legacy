import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { localDate, dayStart, agendaRange } from '@shared/agenda'
import type { AgendaItem } from '@shared/agenda'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { CalendarPage } from './CalendarPage'

const TZ = 'America/Sao_Paulo'
const today = localDate(Date.now(), TZ)
/** 13:00 → 15:45 local today, like the roadmap example. */
const at = (h: number, m = 0) => new Date(dayStart(today, TZ) + (h * 60 + m) * 60_000).toISOString()
const item = (over: Partial<AgendaItem> = {}): AgendaItem => ({ id: 'c1', workspaceId: WS_ID, name: 'Meme', revision: 2, provider: 'instagram', destinationAccountId: '111', accountRevision: 'r', timeZone: TZ,
  plannedStartAt: at(13), plannedEndAt: at(15, 45), intervalMin: 15, trialGraduation: null, captionBase: '', visualSnapshot: { version: 1 }, scheduledAt: at(9), controlState: 'active', state: 'in_progress',
  counts: { total: 12, confirmed: 7, pending: 5, running: 0, failed: 0, cancelled: 0, terminal: 7, started: 7, remoteOpen: 0, waitingQuota: 0 }, plannedDurationMin: 165,
  estimatedEndAt: at(16, 7), delayMin: 22, quotaDemand: 12, quotaTotal: null, quotaAvailable: null, firstStartedAt: null, lastConfirmedAt: null, createdAt: at(8), updatedAt: at(9), username: 'meme.a', ...over })

describe('CalendarPage', () => {
  it('week view shows one block per Container with destination, size, window, progress and delay', async () => {
    const invoke = mockBridge({ 'agenda.range': () => ({ timeZone: TZ, truncated: false, items: [item(), item({ id: 'd1', name: 'Rascunho', state: 'draft', scheduledAt: null, plannedStartAt: at(18), plannedEndAt: at(19) })] }), 'accounts.instagramList': () => [{ id: '111', username: 'meme.a', revision: 'r', validatedAt: at(0) }] })
    renderWithApp(<CalendarPage navigate={vi.fn()} />)
    const block = await screen.findByRole('article', { name: 'Meme' })
    expect(block).toHaveTextContent('Instagram · @meme.a')
    expect(block).toHaveTextContent('12 publicações')
    expect(block).toHaveTextContent('13:00 → 15:45')
    expect(block).toHaveTextContent('7/12 · +22 min · Em andamento')
    expect(screen.getByRole('article', { name: 'Rascunho' })).toHaveAttribute('data-state', 'draft')
    const week = agendaRange('week', today, TZ)
    expect(invoke).toHaveBeenCalledWith('agenda.range', { workspaceId: WS_ID, from: week.from, to: week.to })
  })

  it('month, day and timeline views; navigation and account filter re-query the range', async () => {
    const invoke = mockBridge({ 'agenda.range': () => ({ timeZone: TZ, truncated: false, items: [item()] }), 'accounts.instagramList': () => [{ id: '111', username: 'meme.a', revision: 'r', validatedAt: at(0) }] })
    renderWithApp(<CalendarPage navigate={vi.fn()} />)
    await screen.findByRole('article', { name: 'Meme' })
    await userEvent.click(screen.getByRole('button', { name: 'Mês' }))
    expect(within(await screen.findByTestId('agenda-month')).getByRole('article', { name: 'Meme' })).toHaveTextContent('13:00 → 15:45')
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(within(await screen.findByTestId('agenda-timeline')).getByRole('img', { name: /^Meme: / })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dia' }))
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }))
    const tomorrow = agendaRange('day', new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10), TZ)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agenda.range', { workspaceId: WS_ID, from: tomorrow.from, to: tomorrow.to }))
    await userEvent.click(screen.getByRole('button', { name: 'Conta' }))
    await userEvent.click(await screen.findByRole('option', { name: '@meme.a' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agenda.range', { workspaceId: WS_ID, from: tomorrow.from, to: tomorrow.to, accountId: '111' }))
  })

  it('empty, truncated and error states', async () => {
    let mode: 'empty' | 'many' | 'error' = 'empty'
    mockBridge({ 'agenda.range': () => { if (mode === 'error') throw { code: 'internal', message: 'x' }; return { timeZone: TZ, truncated: mode === 'many', items: mode === 'many' ? [item()] : [] } } })
    renderWithApp(<CalendarPage navigate={vi.fn()} />)
    expect(await screen.findByText('Nenhum Container neste período')).toBeInTheDocument()
    mode = 'many'
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }))
    expect(await screen.findByText(/Muitos Containers neste período/)).toBeInTheDocument()
    mode = 'error'
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }))
    expect(await screen.findByText(/Não foi possível carregar a agenda/)).toBeInTheDocument()
  })
})

it('a positioned draft without destination is labelled as such, never as Instagram', async () => {
  mockBridge({ 'agenda.range': () => ({ timeZone: TZ, truncated: false, items: [item({ id: 'x', name: 'Sem conta', state: 'draft', provider: null, destinationAccountId: null, username: null, scheduledAt: null })] }) })
  renderWithApp(<CalendarPage navigate={vi.fn()} />)
  const block = await screen.findByRole('article', { name: 'Sem conta' })
  expect(block).toHaveTextContent('Sem destino')
  expect(block).not.toHaveTextContent('Instagram')
})

describe('CalendarPage drag & drop', () => {
  it('moving a Container (Alt + seta) shows the impact first and applies only after confirming', async () => {
    const preview = { revision: 2, deltaMin: 15, blocked: null, before: { startAt: at(13), endAt: at(15, 45) }, after: { startAt: at(13, 15), endAt: at(16), estimatedEndAt: at(16) },
      slots: [{ jobId: 'j8', at: at(15, 15), before: at(15) }], unchanged: { published: 7, inFlight: 1, failed: 0 }, quotaConsidered: true, quotaDeferred: 0, delayMin: 0,
      conflicts: [{ start: at(15), end: at(16) }], insidePeak: false }
    const invoke = mockBridge({ 'agenda.range': () => ({ timeZone: TZ, truncated: false, items: [item(), item({ id: 'd1', name: 'Rascunho', state: 'draft', scheduledAt: null, plannedStartAt: at(18), plannedEndAt: at(19) })] }), 'containers.drag.preview': () => preview, 'containers.drag.apply': () => ({}) })
    renderWithApp(<CalendarPage navigate={vi.fn()} />)
    const open = await screen.findByRole('button', { name: 'Abrir Meme' })
    expect(screen.getByRole('button', { name: 'Abrir Rascunho' })).toHaveAttribute('title', 'Rascunhos não têm horário publicado.')
    open.focus()
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    const dialog = await screen.findByRole('dialog', { name: 'Mover Meme?' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('containers.drag.preview', { workspaceId: WS_ID, containerId: 'c1', startAt: at(13, 15) }))
    expect(await within(dialog).findByText('1 vídeo(s) reagendado(s)')).toBeInTheDocument()
    expect(within(dialog).getByText('7 publicado(s) não mudam')).toBeInTheDocument()
    expect(within(dialog).getByText('Sobrepõe 1 outra(s) programação(ões) desta conta.')).toBeInTheDocument()
    expect(within(dialog).getByText('Fica fora das janelas de pico configuradas.')).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalledWith('containers.drag.apply', expect.anything())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar movimentação' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('containers.drag.apply', { workspaceId: WS_ID, containerId: 'c1', expectedRevision: 2, startAt: at(13, 15), slots: [{ jobId: 'j8', at: at(15, 15) }] }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mover Meme?' })).toBeNull())
  })

  it('a blocked move explains why and cannot be confirmed', async () => {
    const invoke = mockBridge({ 'agenda.range': () => ({ timeZone: TZ, truncated: false, items: [item()] }), 'containers.drag.preview': () => ({ revision: 2, deltaMin: -60, blocked: 'Escolha um horário no futuro.', before: { startAt: at(13), endAt: at(15, 45) }, after: { startAt: at(12), endAt: at(14, 45), estimatedEndAt: null }, slots: [], unchanged: { published: 0, inFlight: 0, failed: 0 }, quotaConsidered: false, quotaDeferred: 0, delayMin: null, conflicts: [], insidePeak: null }) })
    renderWithApp(<CalendarPage navigate={vi.fn()} />)
    ;(await screen.findByRole('button', { name: 'Abrir Meme' })).focus()
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    const dialog = await screen.findByRole('dialog', { name: 'Mover Meme?' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Escolha um horário no futuro.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar movimentação' }))
    expect(invoke).not.toHaveBeenCalledWith('containers.drag.apply', expect.anything())
  })
})
