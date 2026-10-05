import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { LibraryPage } from './LibraryPage'
const item = { id: 'a1', kind: 'asset', thumbnailPath: null, permalink: null, caption: 'clip.mp4', postedAt: null, durationMs: 4000, metrics: { views: 1000, likes: 10, comments: null }, badges: [], status: 'ready' }
const one = () => ({ items: [item], total: 1, loadedNote: '1 resultado' })
describe('media manager interactions', () => {
  it('bulk deletion is reviewed; blocked media is reported instead of silently removed', async () => {
    const invoke = mockBridge({ 'grid.query': one, 'library.deleteMany': () => ({ deleted: [], blocked: ['a1'], failed: [] }) })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar clip.mp4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excluir selecionados' }))
    expect(invoke).not.toHaveBeenCalledWith('library.deleteMany', expect.anything())
    const modal = screen.getByRole('dialog', { name: 'Excluir 1 vídeos?' })
    expect(modal).toHaveTextContent('tarefas ativas ou agendadas serão preservados')
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('library.deleteMany', { workspaceId: WS_ID, ids: ['a1'] }))
    expect(await screen.findByText('1 em uso preservados; 0 falhas.')).toBeInTheDocument()
  })
  it('search and status reach the paginated backend; view choice persists', async () => {
    let list = false
    const invoke = mockBridge({ 'grid.query': one, 'settings.get': i => i.key === 'mediaViewList' && list ? 'true' : null, 'settings.set': i => { if (i.key === 'mediaViewList') list = i.value === 'true'; return null } })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    await userEvent.type(await screen.findByLabelText('Buscar mídia'), 'origin')
    await userEvent.selectOptions(screen.getByLabelText('Estado da mídia'), 'published')
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('grid.query', expect.objectContaining({ text: 'origin', status: 'published', limit: 60, offset: 0 })))
    await userEvent.click(screen.getByRole('button', { name: 'Visualização em lista' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('settings.set', { workspaceId: WS_ID, key: 'mediaViewList', value: 'true' })
  })
  it('shows actual pending files without inventing percentages', async () => {
    mockBridge({ 'grid.query': () => ({ items: [], total: 0, loadedNote: '' }), 'library.pending': () => [{ id: 'job', label: 'Baixar reel ABCDE', state: 'running', error: null }] })
    renderWithApp(<LibraryPage navigate={vi.fn()} />)
    expect(await screen.findByText('Baixar reel ABCDE')).toBeInTheDocument()
    expect(screen.getByText('Processando…')).toBeInTheDocument()
    expect(screen.queryByText(/82%/)).not.toBeInTheDocument()
  })
})
