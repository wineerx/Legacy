import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { ContainerDraftSheet } from './ContainerDraftSheet'
import { LibraryPage } from './LibraryPage'
import { detail, media } from './container-draft.fixtures'

const account = { id: '123', username: 'destino', revision: 'r1', validatedAt: '2026-10-09T13:00:00Z' }
const sheet = (mode: 'new' | 'append' | 'manage', videos = [media('a'), media('b')], onClose = vi.fn()) => renderWithApp(<ContainerDraftSheet workspaceId={WS_ID} timeZone="America/Sao_Paulo" request={{ mode, videos }} onClose={onClose} />)
const reviewSave = async () => { await userEvent.click(screen.getByRole('button', { name: 'Revisar rascunho' })); await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' })) }

describe('Container draft flow', () => {
  it('cria com revisão, remove/reordena/visualiza sem FFmpeg/jobs; mantém seleção, filtro e página', async () => {
    const all = Array.from({ length: 65 }, (_, n) => media(`video-${n}`))
    let payload: any
    const invoke = mockBridge({ 'grid.query': ({ offset }) => ({ items: all.slice(offset, offset + 2), total: 65 }), 'accounts.instagramList': () => [account], 'containers.create': input => { payload = input; return detail(input.draft.items.map((v: any) => v.assetId)) } })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Buscar mídia'), { target: { value: 'video' } })
    await userEvent.click(await screen.findByRole('button', { name: 'Próxima página' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar video-60.mp4' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar video-61.mp4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar novo Container' }))
    await screen.findByRole('dialog', { name: 'Container em rascunho' })
    await userEvent.clear(screen.getByLabelText('Nome do Container')); await userEvent.type(screen.getByLabelText('Nome do Container'), 'Lote da Biblioteca')
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Destino do Container' }), { key: 'ArrowDown' }); await userEvent.click(await screen.findByRole('option', { name: 'Instagram · @destino' }))
    await userEvent.click(screen.getByRole('button', { name: 'Visualizar video-60.mp4' }))
    expect(await screen.findByLabelText('Prévia do rascunho')).toHaveAttribute('src', expect.stringContaining('legacy-media://'))
    await userEvent.click(screen.getByRole('button', { name: 'Fechar prévia' }))
    await userEvent.click(screen.getByRole('button', { name: 'Subir video-61.mp4' }))
    expect(screen.getAllByTestId('draft-video')[0]).toHaveAttribute('data-asset-id', 'video-61')
    await userEvent.click(screen.getByRole('button', { name: 'Remover video-60.mp4' }))
    await reviewSave()
    await screen.findByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.')
    expect(payload.draft).toMatchObject({ name: 'Lote da Biblioteca', destinationAccountId: '123', provider: 'instagram', items: [{ assetId: 'video-61' }] })
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.getByLabelText('Buscar mídia')).toHaveValue('video')
    expect(screen.getByText('61–65 de 65 vídeos')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Selecionar video-60.mp4' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Selecionar video-61.mp4' })).toBeChecked()
    const channels = invoke.mock.calls.map(c => c[0])
    expect(channels.some(c => ['containers.schedule', 'library.frame', 'library.details', 'jobs.create', 'compose.schedule'].includes(c))).toBe(false)
  }, 15_000)

  it('adiciona somente novos vídeos e salva toda a lista com a revisão original', async () => {
    const d = detail(['a', 'b']); let updated: any
    mockBridge({ 'accounts.instagramList': () => [account], 'containers.query': () => ({ items: [d.container], total: 1 }), 'containers.get': () => d, 'containers.updateDraft': input => { updated = input; return { ...d, container: { ...d.container, revision: 2 } } } })
    sheet('append', [media('b'), media('c')])
    await userEvent.click(await screen.findByRole('button', { name: /Meu lote/ }))
    expect(await screen.findByText('1 vídeo(s) adicionado(s); 1 já presente(s).')).toBeInTheDocument()
    await reviewSave()
    await waitFor(() => expect(updated).toBeDefined())
    expect(updated.expectedRevision).toBe(1)
    expect(updated.draft.items.map((v: any) => v.assetId)).toEqual(['a', 'b', 'c'])
  })
  it('reabre, edita nome/destino e pagina os rascunhos', async () => {
    const d = detail(); let updated: any
    const invoke = mockBridge({ 'accounts.instagramList': () => [account], 'containers.query': ({ page }) => ({ items: page === 1 ? [{ ...d.container, name: 'Primeiro' }] : [d.container], total: 11 }), 'containers.get': () => d, 'containers.updateDraft': input => { updated = input; return { ...d, container: { ...d.container, revision: 2 } } } })
    sheet('manage', [])
    await userEvent.click(await screen.findByRole('button', { name: 'Próxima página' }))
    await userEvent.click(await screen.findByRole('button', { name: /Meu lote/ }))
    await userEvent.clear(screen.getByLabelText('Nome do Container')); await userEvent.type(screen.getByLabelText('Nome do Container'), 'Renomeado')
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Destino do Container' }), { key: 'ArrowDown' }); await userEvent.click(await screen.findByRole('option', { name: 'Instagram · @destino' }))
    await reviewSave()
    await waitFor(() => expect(updated?.draft.name).toBe('Renomeado'))
    expect(updated.draft.destinationAccountId).toBe('123')
    expect(invoke).toHaveBeenCalledWith('containers.query', { workspaceId: WS_ID, state: 'draft', page: 2, pageSize: 10 })
  })
  it('recusa editar um rascunho agendado entre a listagem e abertura', async () => {
    const d = detail()
    const invoke = mockBridge({ 'accounts.instagramList': () => [], 'containers.query': () => ({ items: [d.container], total: 1 }), 'containers.get': () => ({ ...d, container: { ...d.container, state: 'scheduled', scheduledAt: '2026-10-10T13:00:00Z' } }) })
    sheet('manage')
    await userEvent.click(await screen.findByRole('button', { name: /Meu lote/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('já foi agendado')
    expect(screen.queryByLabelText('Nome do Container')).not.toBeInTheDocument()
    expect(invoke.mock.calls.some(c => c[0] === 'containers.updateDraft')).toBe(false)
  })
  it('mostra conflito sem perder mudanças nem sobrescrever a nova revisão', async () => {
    const d = detail()
    const invoke = mockBridge({ 'accounts.instagramList': () => [], 'containers.query': () => ({ items: [d.container], total: 1 }), 'containers.get': () => d, 'containers.updateDraft': () => { throw { code: 'invalid_input', message: 'O Container mudou. Atualize antes de confirmar.' } } })
    sheet('manage')
    await userEvent.click(await screen.findByRole('button', { name: /Meu lote/ }))
    await userEvent.clear(screen.getByLabelText('Nome do Container')); await userEvent.type(screen.getByLabelText('Nome do Container'), 'Edição local')
    await reviewSave()
    expect(await screen.findByRole('alert')).toHaveTextContent('O Container mudou')
    expect(screen.getByLabelText('Nome do Container')).toHaveValue('Edição local')
    expect(invoke.mock.calls.filter(c => c[0] === 'containers.updateDraft')).toHaveLength(1)
  })
  it('reutiliza requestId após resposta perdida da criação e bloqueia duplo clique', async () => {
    let attempts = 0
    const invoke = mockBridge({ 'accounts.instagramList': () => [], 'containers.create': async () => { if (!attempts++) throw { code: 'internal', message: 'Resposta perdida' }; return detail() } })
    sheet('new')
    await screen.findByLabelText('Nome do Container')
    await reviewSave()
    expect(await screen.findByRole('alert')).toHaveTextContent('Resposta perdida')
    await userEvent.dblClick(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await screen.findByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.')
    const calls = invoke.mock.calls.filter(c => c[0] === 'containers.create')
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toEqual(calls[1][1])
  })
  it('recupera resposta perdida de updateDraft pela leitura sem repetir a escrita', async () => {
    const d = detail(); let stored = d
    const invoke = mockBridge({ 'accounts.instagramList': () => [], 'containers.query': () => ({ items: [d.container], total: 1 }), 'containers.get': () => stored,
      'containers.updateDraft': input => { stored = { ...d, container: { ...d.container, name: input.draft.name, revision: 2 } }; throw { code: 'internal', message: 'Resposta perdida' } } })
    sheet('manage')
    await userEvent.click(await screen.findByRole('button', { name: /Meu lote/ }))
    fireEvent.change(screen.getByLabelText('Nome do Container'), { target: { value: 'Salvo no banco' } })
    await reviewSave()
    await screen.findByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.')
    expect(invoke.mock.calls.filter(c => c[0] === 'containers.updateDraft')).toHaveLength(1)
  })
  it('bloqueia também a revisão aberta quando outro cliente agenda o Container', async () => {
    const d = detail(); let scheduled = false
    mockBridge({ 'accounts.instagramList': () => [], 'containers.query': () => ({ items: [d.container], total: 1 }), 'containers.get': () => scheduled ? { ...d, container: { ...d.container, state: 'scheduled', scheduledAt: '2026-10-10T13:00:00Z', revision: 2 } } : d,
      'containers.updateDraft': () => { scheduled = true; throw { code: 'invalid_input', message: 'O Container mudou.' } } })
    sheet('manage')
    await userEvent.click(await screen.findByRole('button', { name: /Meu lote/ }))
    await reviewSave()
    expect(await screen.findByRole('alert')).toHaveTextContent('edição está bloqueada')
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Voltar à edição' })).toBeDisabled()
  })
  it('confirma descarte, e drag/drop só altera a ordem local até salvar', async () => {
    const close = vi.fn(); const invoke = mockBridge({ 'accounts.instagramList': () => [] })
    sheet('new', [media('a'), media('b')], close)
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(await screen.findByRole('button', { name: 'Arrastar a.mp4' }), { dataTransfer })
    fireEvent.dragOver(screen.getAllByTestId('draft-video')[1], { dataTransfer })
    fireEvent.drop(screen.getAllByTestId('draft-video')[1], { dataTransfer })
    expect(screen.getAllByTestId('draft-video')[0]).toHaveAttribute('data-asset-id', 'b')
    expect(invoke.mock.calls.some(c => c[0] === 'containers.create')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Descartar alterações do rascunho?' })
    expect(close).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar alterações' }))
    expect(close).toHaveBeenCalledOnce()
  })
})
