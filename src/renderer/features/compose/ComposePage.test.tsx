import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { ComposePage } from './ComposePage'
import { setComposeSelection, clearComposeSelection } from '../../lib/selection'

const item = { id: 'a1', kind: 'asset', thumbnailPath: null, permalink: null, caption: 'a.mp4', postedAt: null, durationMs: 30_000, metrics: { views: null, likes: null, comments: null }, badges: [] }
const base = { 'covers.list': () => [], 'settings.get': () => 'true', 'grid.query': () => ({ items: [item], total: 1, loadedNote: '' }) }

describe('ComposePage', () => {
  it('conta Instagram conectada cria tarefa real pelo backend de composição', async()=>{
    setComposeSelection(['a1'])
    const invoke=mockBridge({...base,'accounts.instagram':()=>({id:'123',revision:'rev',username:'destino',validatedAt:new Date().toISOString()}),'grid.query':()=>({items:[{...item,postId:'post-1'}],total:1,loadedNote:''}),'compose.scheduleInstagram':()=>[]})
    const navigate=vi.fn();renderWithApp(<ComposePage navigate={navigate}/>)
    await userEvent.click(await screen.findByRole('checkbox',{name:'Instagram — @destino'}))
    await userEvent.click(screen.getByRole('checkbox',{name:'TikTok — exportação manual'}))
    const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10)
    fireEvent.change(screen.getByLabelText('Data'),{target:{value:tomorrow}})
    fireEvent.change(screen.getByLabelText('Horário'),{target:{value:'18:30'}})
    await userEvent.click(screen.getByRole('button',{name:'Revisar lote'}))
    await userEvent.click(screen.getByRole('button',{name:'Confirmar destinos'}))
    await waitFor(()=>expect(navigate).toHaveBeenCalledWith('queue'))
    expect(invoke).toHaveBeenCalledWith('compose.scheduleInstagram',expect.objectContaining({assetIds:['a1'],accountId:'123',accountRevision:'rev'}))
    expect(invoke.mock.calls.some(c=>c[0]==='export.tiktok')).toBe(false)
  })
  beforeEach(() => clearComposeSelection())

  it('sem seleção convida a escolher na biblioteca', async () => {
    mockBridge({ 'covers.list': () => [], 'settings.get': () => null })
    const navigate = vi.fn()
    renderWithApp(<ComposePage navigate={navigate} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Escolher na biblioteca' }))
    expect(navigate).toHaveBeenCalledWith('library')
  })

  it('com seleção mostra itens e abre a revisão', async () => {
    setComposeSelection(['a1'])
    mockBridge({
      'covers.list': () => [], 'settings.get': () => 'true',
      'grid.query': () => ({ items: [{ id: 'a1', kind: 'asset', thumbnailPath: null, permalink: null, caption: 'a.mp4', postedAt: null, durationMs: 30_000, metrics: { views: null, likes: null, comments: null }, badges: [] }], total: 1, loadedNote: '' })
    })
    renderWithApp(<ComposePage navigate={vi.fn()} />)
    expect(await screen.findByText('a.mp4')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Legenda base'), 'Minha legenda #fyp')
    await userEvent.click(screen.getByRole('button', { name: 'Revisar lote' }))
    expect(await screen.findByRole('dialog', { name: 'Revisar lote' })).toHaveTextContent('Minha legenda #fyp')
  })

  it('executa o lote sem capa nem banner e vai para a fila', async () => {
    setComposeSelection(['a1'])
    const invoke = mockBridge({ ...base, 'export.tiktok': () => ({ jobIds: [] }) })
    const navigate = vi.fn()
    renderWithApp(<ComposePage navigate={navigate} />)
    await screen.findByText('a.mp4')
    await userEvent.type(screen.getByLabelText('Legenda base'), 'Base')
    await userEvent.click(screen.getByRole('button', { name: 'Revisar lote' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar para TikTok' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('queue'))
    expect(invoke).toHaveBeenCalledWith('export.tiktok', { workspaceId: WS_ID, assetIds: ['a1'], captions: { a1: 'Base' }, stripMetadata: true, remindAt: [null] })
  })

  it('erro na exportação mostra aviso', async () => {
    setComposeSelection(['a1'])
    mockBridge({ ...base, 'export.tiktok': () => { throw { code: 'invalid_media', message: 'x' } } })
    renderWithApp(<ComposePage navigate={vi.fn()} />)
    await screen.findByText('a.mp4')
    await userEvent.click(screen.getByRole('button', { name: 'Revisar lote' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar para TikTok' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível preparar o lote')
  })

  it('limpar a legenda própria volta para a base', async () => {
    setComposeSelection(['a1'])
    const invoke = mockBridge({ ...base, 'export.tiktok': () => ({ jobIds: [] }) })
    renderWithApp(<ComposePage navigate={vi.fn()} />)
    await screen.findByText('a.mp4')
    await userEvent.type(screen.getByLabelText('Legenda base'), 'Base')
    const own = screen.getByLabelText('Legenda própria de a.mp4')
    await userEvent.type(own, 'Própria')
    await userEvent.clear(own)
    await userEvent.click(screen.getByRole('button', { name: 'Revisar lote' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar para TikTok' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('export.tiktok', expect.objectContaining({ captions: { a1: 'Base' } })))
  })
})
