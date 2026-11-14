import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { LibraryPage } from './LibraryPage'

const emptyGrid = () => ({ items: [], total: 0, loadedNote: '0 vídeos na biblioteca.' })

const lastGrid = (invoke: { mock: { calls: unknown[][] } }) => invoke.mock.calls.filter(c => c[0] === 'grid.query').at(-1)?.[1]

describe('LibraryPage', () => {
  it('estado vazio com importação', async () => {
    const invoke = mockBridge({ 'grid.query': emptyGrid, 'library.pickAndImport': () => [] })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Comece pela biblioteca' })).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Importar vídeos' })[0])
    expect(invoke).toHaveBeenCalledWith('library.pickAndImport', { workspaceId: WS_ID })
  })

  it('arrastar e soltar importa pelos caminhos e mostra rejeitados', async () => {
    const invoke = mockBridge({
      'grid.query': emptyGrid,
      'library.importPaths': () => [{ path: 'C:\\fake\\a.mp4', status: 'rejected', errors: ['O arquivo não parece ser um vídeo válido.'], warnings: [] }]
    })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    const zone = await screen.findByTestId('drop-zone')
    const file = new File(['x'], 'a.mp4', { type: 'video/mp4' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('library.importPaths', { workspaceId: WS_ID, paths: ['C:\\fake\\a.mp4'] }))
    expect(await screen.findByRole('dialog', { name: 'Resultado da importação' })).toHaveTextContent('O arquivo não parece ser um vídeo válido.')
  })

  it('selecionar e preparar para TikTok navega para criar postagem', async () => {
    const navigate = vi.fn()
    mockBridge({
      'grid.query': () => ({
        items: [{ id: 'a1', kind: 'asset', thumbnailPath: null, permalink: null, caption: 'a.mp4', postedAt: null, durationMs: 1000, metrics: { views: null, likes: null, comments: null }, badges: [] }],
        total: 1, loadedNote: '1 vídeos na biblioteca.'
      })
    })
    renderWithApp(<LibraryPage navigate={navigate} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar a.mp4' }))
    expect(screen.getByText('1 selecionado')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Preparar lote' }))
    expect(navigate).toHaveBeenCalledWith('compose')
  })
  const oneItem = () => ({
    items: [{ id: 'a1', kind: 'asset', thumbnailPath: null, permalink: null, caption: 'a.mp4', postedAt: null, durationMs: 1000, metrics: { views: null, likes: null, comments: null }, badges: [] }],
    total: 1, loadedNote: '1 vídeos na biblioteca.'
  })

  it('falha ao favoritar mostra toast de erro', async () => {
    mockBridge({ 'grid.query': oneItem, 'library.setFavorite': () => { throw { code: 'internal', message: 'Disco cheio.' } } })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Favoritar' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível favoritar')
    expect(alert).toHaveTextContent('Disco cheio.')
  })

  it('excluir confirma e chama library.delete com o id', async () => {
    const invoke = mockBridge({ 'grid.query': oneItem, 'library.delete': () => ({}) })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('dialog', { name: 'Excluir vídeo?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('library.delete', { workspaceId: WS_ID, id: 'a1' }))
  })

  it('trocar o filtro limpa a seleção', async () => {
    mockBridge({ 'grid.query': oneItem })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar a.mp4' }))
    expect(screen.getByText('1 selecionado')).toBeInTheDocument()
    const panel = screen.getByRole('complementary', { name: 'Filtros' })
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Somente favoritos' }))
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Ações da seleção' })).toBeNull())
  })

  it('estados se combinam por OU e podem ser desmarcados pelo painel', async () => {
    const invoke = mockBridge({ 'grid.query': oneItem })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    const panel = await screen.findByRole('complementary', { name: 'Filtros' })
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Agendados' }))
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Não agendados' }))
    await waitFor(() => expect(lastGrid(invoke)).toEqual(expect.objectContaining({ statuses: ['scheduled', 'unscheduled'] })))
    const toolbar = within(screen.getByRole('search', { name: 'Filtrar biblioteca' }))
    expect(toolbar.queryByRole('button', { name: /^(estado|período de importação|favoritos|filtros)/i })).toBeNull()
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Agendados' }))
    await waitFor(() => expect(lastGrid(invoke)).toEqual(expect.objectContaining({ statuses: ['unscheduled'] })))
    await userEvent.click(within(panel).getByRole('button', { name: 'Limpar todos' }))
    await waitFor(() => expect(lastGrid(invoke)).toEqual(expect.objectContaining({ statuses: undefined })))
  })

  it('Perfil de origem só aparece com perfis que têm vídeo baixado', async () => {
    const first = mockBridge({ 'grid.query': oneItem })
    const { unmount } = renderWithApp(<LibraryPage navigate={vi.fn()} />)
    await waitFor(() => expect(first).toHaveBeenCalledWith('library.filterOptions', { workspaceId: WS_ID }))
    expect(screen.queryByRole('group', { name: 'Perfil de origem' })).toBeNull()
    unmount()
    const invoke = mockBridge({ 'grid.query': oneItem, 'library.filterOptions': () => ({ profiles: [{ id: 'p1', username: 'rios.br', platform: 'instagram', count: 3 }], accounts: [] }) })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    const panel = await screen.findByRole('complementary', { name: 'Filtros' })
    await userEvent.click(await within(panel).findByRole('checkbox', { name: '@rios.br' }))
    await waitFor(() => expect(lastGrid(invoke)).toEqual(expect.objectContaining({ sourceProfileIds: ['p1'] })))
    expect(within(screen.getByRole('group', { name: 'Perfil de origem' })).getByText('@rios.br')).toBeInTheDocument()
  })

  it('Fila de mídia fica no menu de ações da barra da biblioteca', async () => {
    const navigate = vi.fn()
    mockBridge({ 'grid.query': oneItem, 'library.pending': () => [{ id: 'j1', label: 'Baixar reel @rios', state: 'failed', error: 'Link expirado.' }] })
    renderWithApp(<LibraryPage navigate={navigate} />)
    const toolbar = await screen.findByRole('search', { name: 'Filtrar biblioteca' })
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Ações da biblioteca' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Fila de mídia, 1 tarefa(s), 1 com falha' }))
    const sheet = await screen.findByRole('dialog', { name: 'Fila de mídia' })
    expect(sheet).toHaveTextContent('Baixar reel @rios')
    expect(sheet).toHaveTextContent('Link expirado.')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Abrir Fila completa' }))
    expect(navigate).toHaveBeenCalledWith('queue')
  })
})
