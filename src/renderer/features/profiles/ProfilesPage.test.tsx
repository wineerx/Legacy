import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { ProfilesPage } from './ProfilesPage'

const profile = { id: 'p1', username: 'zanon.boss', url: 'https://www.instagram.com/zanon.boss/', connected: false, lastSyncedAt: null }

describe('ProfilesPage', () => {
  it('enfileira download com limite e perfil selecionado', async () => {
    const invoke = mockBridge({
      'profiles.list': () => [profile], 'profiles.downloadStatus': () => ({ configured: true }),
      'profiles.download': () => ({ id: 'job1' }), 'grid.query': () => ({ items: [], total: 0, loadedNote: '' })
    })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar vídeos do perfil' }))
    const input = screen.getByLabelText('Máximo de vídeos')
    await userEvent.clear(input)
    await userEvent.type(input, '5')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar e baixar' }))
    expect(invoke).toHaveBeenCalledWith('profiles.download', { workspaceId: WS_ID, profileId: profile.id, limit: 5 })
    expect(await screen.findByText('Busca adicionada à fila')).toBeInTheDocument()
  })

  it('explica configuração ausente e impede download', async () => {
    mockBridge({ 'profiles.list': () => [profile], 'profiles.downloadStatus': () => ({ configured: false }), 'grid.query': () => ({ items: [], total: 0, loadedNote: '' }) })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar vídeos do perfil' }))
    expect(await screen.findByText(/Cadastre a chave Apify/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buscar e baixar' })).toBeDisabled()
  })
  it('mostra erro de URL inválida', async () => {
    mockBridge({
      'profiles.list': () => [],
      'profiles.add': () => { throw { code: 'invalid_url', message: 'Link do Instagram inválido. Use instagram.com/usuario ou o link de um reel.' } }
    })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    await userEvent.type(await screen.findByLabelText('Link do perfil'), 'https://evil.com/x')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar perfil' }))
    expect(await screen.findByText(/Link do Instagram inválido/)).toBeInTheDocument()
  })

  it('perfil não conectado explica limite e ordena por mais vistos', async () => {
    const invoke = mockBridge({
      'profiles.list': () => [profile],
      'grid.query': () => ({ items: [], total: 0, loadedNote: 'Ranking cobre os 0 posts carregados deste perfil.' })
    })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    expect(await screen.findByText(/Busca e download de reels públicos via Apify/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mais curtidos' }))
    expect(invoke).toHaveBeenCalledWith('grid.query', expect.objectContaining({ workspaceId: WS_ID, source: 'remote', profileId: 'p1', sortBy: 'likes', sortDir: 'desc' }))
  })

  it('erro na grade mostra mensagem em vez do estado vazio', async () => {
    mockBridge({ 'profiles.list': () => [profile], 'grid.query': () => { throw { code: 'internal', message: 'Banco indisponível.' } } })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    expect(await screen.findByText(/Não foi possível carregar os posts./)).toHaveTextContent('Banco indisponível.')
    expect(screen.queryByText('Nenhum post ainda')).not.toBeInTheDocument()
  })

  it('erro ao adicionar reel aparece no modal', async () => {
    mockBridge({
      'profiles.list': () => [profile],
      'grid.query': () => ({ items: [], total: 0, loadedNote: '' }),
      'profiles.addReel': () => { throw { code: 'invalid_url', message: 'Link de reel inválido.' } }
    })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar link de reel' }))
    await userEvent.type(await screen.findByLabelText('Link do reel'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(await screen.findByText('Link de reel inválido.')).toBeInTheDocument()
  })

  it('Programar selecionados exige vídeo baixado', async () => {
    const mk = (id: string, assetId: string | null) => ({ id, kind: 'remote', assetId, thumbnailPath: null, permalink: `https://www.instagram.com/reel/${id}/`, caption: id, postedAt: null, durationMs: 10_000, metrics: { views: 1, likes: 1, comments: 1 }, badges: [] })
    mockBridge({
      'profiles.list': () => [profile], 'profiles.downloadStatus': () => ({ configured: true }),
      'accounts.instagram': () => ({ id: '123', revision: 'rev', username: 'destino', validatedAt: new Date().toISOString() }),
      'grid.query': () => ({ items: [mk('p1', 'a1'), mk('p2', null)], total: 2, loadedNote: '' })
    })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Selecionar página' }))
    await userEvent.click(screen.getByRole('button', { name: 'Programar selecionados' }))
    expect(await screen.findByText('Baixe os vídeos selecionados antes de programar. O Instagram publica a cópia local.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar agendamento' })).toBeDisabled()
  })
})
