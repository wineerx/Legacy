import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { ProfilesPage } from './ProfilesPage'

const profile = { platform: 'instagram', id: 'p1', username: 'zanon.boss', url: 'https://www.instagram.com/zanon.boss/', connected: false, lastSyncedAt: null }

describe('ProfilesPage', () => {
  it('reload consulta apenas dados do perfil sem iniciar busca de conteúdo', async () => {
    const invoke = mockBridge({
      'profiles.list': () => [profile],
      'profiles.refresh': () => ({ postsCount: 45, reelsCount: null, followersCount: 100, followingCount: 10, updatedAt: '2026-10-06T12:00:00Z' }),
      'grid.query': () => ({ items: [], total: 0, loadedNote: '' })
    })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar dados de @zanon.boss' }))
    expect(invoke).toHaveBeenCalledWith('profiles.refresh', { workspaceId: WS_ID, profileId: profile.id })
    expect(await screen.findByText('Dados do perfil atualizados')).toBeInTheDocument()
    expect(invoke.mock.calls.some(([channel]) => channel === 'profiles.discover' || channel === 'profiles.download')).toBe(false)
  })
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
    await userEvent.click(screen.getByRole('button', { name: 'Importar perfil' }))
    expect((await screen.findAllByText(/Link do Instagram inválido/))[0]).toBeInTheDocument()
  })

  it('perfil não conectado explica limite e ordena por mais vistos', async () => {
    const invoke = mockBridge({
      'profiles.list': () => [profile],
      'grid.query': () => ({ items: [], total: 0, loadedNote: 'Ranking cobre os 0 posts carregados deste perfil.' })
    })
    renderWithApp(<ProfilesPage navigate={vi.fn()} />)
    expect(await screen.findByText(/— posts/)).toBeInTheDocument()
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

it('mostra progresso indeterminado, reabre resultado real e mantém erro da tarefa', async () => {
  let progress: any = { jobId: 'job-progress', state: 'running', error: null, progress: { phase: 'searching', processed: 0, imported: 0, skipped: 0, previewFailures: 0, total: null, percent: null } }
  mockBridge({ 'profiles.list': () => [profile], 'profiles.importProgress': () => progress, 'grid.query': () => ({ items: [], total: 0, loadedNote: '' }) })
  renderWithApp(<ProfilesPage navigate={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Importar perfil' }))
  expect(await screen.findByText('Buscando posts na Apify…')).toBeVisible()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  progress = { ...progress, state: 'failed', error: 'O provedor encerrou a busca.', progress: { phase: 'importing', processed: 32, total: 80, imported: 30, skipped: 2, previewFailures: 1, percent: 40 } }
  await userEvent.click(screen.getByRole('button', { name: 'Importar perfil' }))
  await waitFor(() => expect(screen.getByText('32 de 80 posts processados · 40%')).toBeVisible(), { timeout: 3500 })
  expect(screen.getByText('O provedor encerrou a busca.')).toBeVisible()
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40')
})

it('envia a origem salva ao atualizar a grade', async () => {
  const invoke = mockBridge({ 'profiles.list': () => [{ ...profile, contentSource: 'tagged' }], 'profiles.downloadStatus': () => ({ configured: true }), 'profiles.discover': () => ({ id: 'job1' }), 'grid.query': () => ({ items: [], total: 0, loadedNote: '' }) })
  renderWithApp(<ProfilesPage navigate={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Atualizar grade' }))
  expect(invoke).toHaveBeenCalledWith('profiles.discover', { workspaceId: WS_ID, profileId: profile.id, limit: 100, source: 'tagged' })
})

it.each(['reels', 'tagged', 'all'] as const)('incorpora perfil usando %s escolhido antes da busca', async (source) => {
  const invoke = mockBridge({ 'profiles.list': () => [], 'profiles.add': () => profile, 'profiles.downloadStatus': () => ({ configured: true }), 'profiles.discover': () => ({ id: 'job1' }), 'grid.query': () => ({ items: [], total: 0, loadedNote: '' }) })
  renderWithApp(<ProfilesPage navigate={vi.fn()} />)
  const group = await screen.findByRole('radiogroup', { name: 'Origem do conteúdo (Instagram)' })
  const selected = within(group).getByRole('radio', { name: source === 'reels' ? 'Reels' : source === 'tagged' ? 'Marcados' : 'Todos' })
  await userEvent.click(selected)
  expect(selected).toHaveAttribute('aria-checked', 'true')
  expect(within(group).getAllByRole('radio').filter(button => button.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  expect(within(group).getAllByRole('radio').every(button => button.textContent === '')).toBe(true)
  await userEvent.type(screen.getByLabelText('Link do perfil'), profile.url)
  await userEvent.click(screen.getByRole('button', { name: 'Importar perfil' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('profiles.discover', { workspaceId: WS_ID, profileId: profile.id, limit: 100, source }))
})

it('exibe a foto do perfil a esquerda do nome no cabecalho', async () => {
  mockBridge({ 'profiles.list': () => [{ ...profile, avatarPath: 'C:/avatars/example.jpg' }], 'grid.query': () => ({ items: [], total: 0, loadedNote: '' }) })
  renderWithApp(<ProfilesPage navigate={vi.fn()} />)
  const heading = await screen.findByRole('heading', { name: '@zanon.boss' })
  const header = heading.closest('header')!
  const avatar = header.querySelector('.size-14')!
  expect(avatar).toBeInTheDocument()
  expect(avatar.nextElementSibling).toContainElement(heading)
})
