import { takeLibraryFocus } from '../../lib/selection'
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { QueuePage } from './QueuePage'

const job = (over: object = {}) => ({ id: 'j1', workspaceId: WS_ID, type: 'export_tiktok', state: 'queued', attempts: 0, maxAttempts: 5, batchId: null, account: null, runAt: '2026-10-05T12:00:00.000Z', lastError: null, label: 'Exportar 2 vídeo(s) para TikTok', createdAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z', ...over })
const paged = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25, counts: { queued: 1, running: 0, failed: 1, done: 0, cancelled: 0 } })
const menu = async (id: string) => userEvent.click(await screen.findByRole('button', { name: `Ações de ${id}` }))
const success = {changed:['j1'],skipped:[]}

describe('Queue monitor', () => {
  it('shows account cooldown and estimated resumption instead of an actionable failure', async () => {
    const limited = job({ type: 'publish_instagram', account: '365spiders', lastError: 'Publicação adiada automaticamente.',
      context: { stage: 'Conta limitada', publicationLimitUntil: '2026-10-08T02:25:00.000Z', priority: 0 } })
    mockBridge({ 'jobs.query': () => paged([limited]), 'jobs.details': () => ({ ...limited, error: limited.lastError,
      attempts: [], attemptTotal: 1, files: [], folders: [], checkpoint: 'Mídia enviada à Meta.' }) })
    renderWithApp(<QueuePage navigate={vi.fn()} />)
    expect(await screen.findByText('Conta limitada')).toBeInTheDocument()
    expect(screen.getByText(/Retomada estimada:/)).toBeInTheDocument()
    expect(screen.queryByText('Publicação adiada automaticamente.')).not.toBeInTheDocument()
    await menu('j1'); await userEvent.click(screen.getByRole('button', { name: 'Ver tarefa' }))
    expect(await screen.findByRole('heading', { name: 'Instagram · Limite de publicações atingido' })).toBeInTheDocument()
    expect(screen.getByText(/Próxima tentativa estimada:/)).toBeInTheDocument()
    expect(screen.queryByText('Falha acionável')).not.toBeInTheDocument()
  })
  it('keeps the action menu open across the live clock refresh',async()=>{
    mockBridge({'jobs.query':()=>paged([job()])})
    renderWithApp(<QueuePage navigate={vi.fn()}/>);await menu('j1')
    expect(await screen.findByRole('button',{name:'Cancelar'})).toBeVisible()
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1200))})
    expect(screen.getByRole('button',{name:'Cancelar'})).toBeVisible()
  })
  it('shows a dense table and actionable failure, confirms cancellation and retry', async () => {
    const invoke = mockBridge({ 'jobs.query': () => paged([job(),job({id:'j2',state:'failed',attempts:5,lastError:'Processamento falhou (código 1)'})]), 'jobs.bulk': () => success })
    renderWithApp(<QueuePage navigate={vi.fn()}/>)
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByText('Andamento e tentativas')).not.toBeInTheDocument()
    expect(screen.getByText('Processamento falhou (código 1)')).toBeInTheDocument()
    await menu('j1')
    await userEvent.click(screen.getByRole('button',{name:'Cancelar'}))
    expect(invoke.mock.calls.some(([channel])=>channel==='jobs.bulk')).toBe(false)
    await userEvent.click(screen.getByRole('button',{name:'Confirmar cancelamento'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.bulk',expect.objectContaining({workspaceId:WS_ID,action:'cancel',items:[{id:'j1',updatedAt:job().updatedAt}]})))
    await menu('j2')
    await userEvent.click(screen.getByRole('button',{name:'Tentar novamente'}))
    await userEvent.click(screen.getByRole('button',{name:'Confirmar'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.bulk',expect.objectContaining({action:'retry',items:[{id:'j2',updatedAt:job().updatedAt}]})))
  })
  it('shows an empty state',async()=>{
    mockBridge({'jobs.query':()=>paged([])})
    renderWithApp(<QueuePage navigate={vi.fn()}/>)
    expect(await screen.findByRole('heading',{name:'Nada na fila'})).toBeInTheDocument()
  })
  it('reports cancellation errors without closing confirmation',async()=>{
    mockBridge({'jobs.query':()=>paged([job()]),'jobs.bulk':()=>{throw {code:'internal',message:'Job já iniciou.'}}})
    renderWithApp(<QueuePage navigate={vi.fn()}/>)
    await menu('j1');await userEvent.click(screen.getByRole('button',{name:'Cancelar'}));await userEvent.click(screen.getByRole('button',{name:'Confirmar cancelamento'}))
    expect(await within(screen.getByRole('dialog',{name:'Cancelar tarefa(s)?'})).findByText('Job já iniciou.')).toBeInTheDocument()
    expect(screen.getByRole('dialog',{name:'Cancelar tarefa(s)?'})).toBeInTheDocument()
  })
  it('keeps server filters and pagination in sync',async()=>{
    const invoke=mockBridge({'jobs.query':i=>({...paged([job()]),total:60,page:i.page,pageSize:i.pageSize})})
    renderWithApp(<QueuePage navigate={vi.fn()}/>)
    await screen.findByText(/60 tarefas/)
    await userEvent.click(screen.getByLabelText('Tipo'));await userEvent.click(await screen.findByRole('option',{name:'Publicação Instagram'}))
    await userEvent.click(screen.getByRole('button',{name:'Próxima página'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.query',expect.objectContaining({page:2,type:'publish_instagram'})))
    await userEvent.type(screen.getByLabelText('Buscar job, vídeo ou conta'),'teste')
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.query',expect.objectContaining({page:1,search:'teste',type:'publish_instagram'})))
  })
  it('reschedules only after confirmation and preserves the revision',async()=>{
    const runAt=new Date(Date.now()+32*86400000).toISOString()
    const invoke=mockBridge({'jobs.query':()=>paged([job({state:'failed'})]),'jobs.tail':()=>({runAt,ahead:3}),'jobs.reschedule':()=>true})
    renderWithApp(<QueuePage navigate={vi.fn()}/>)
    await menu('j1');await userEvent.click(screen.getByRole('button',{name:'Passar a vez'}));await screen.findByText('3 tarefas pendentes antes do horário sugerido.')
    expect(invoke.mock.calls.some(([channel])=>channel==='jobs.reschedule')).toBe(false)
    await userEvent.click(screen.getByRole('button',{name:'Confirmar novo horário'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.reschedule',expect.objectContaining({workspaceId:WS_ID,id:'j1',expectedUpdatedAt:job().updatedAt})))
  })
  it('selects multiple jobs and keeps their original revisions across polling',async()=>{
    const invoke=mockBridge({'jobs.query':()=>paged([job(),job({id:'j2'})]),'jobs.bulk':()=>({changed:['j1','j2'],skipped:[]})})
    renderWithApp(<QueuePage navigate={vi.fn()}/>)
    await userEvent.click(await screen.findByRole('checkbox',{name:'Selecionar página'}))
    expect(screen.getByText('2 selecionada(s)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'Cancelar'}));await userEvent.click(screen.getByRole('button',{name:'Confirmar cancelamento'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.bulk',expect.objectContaining({items:[{id:'j1',updatedAt:job().updatedAt},{id:'j2',updatedAt:job().updatedAt}]})))
  })
  it('groups page jobs by batch and filters the full batch on the server',async()=>{
    const invoke=mockBridge({'jobs.query':()=>paged([job({batchId:'batch-a'}),job({id:'j2',batchId:'batch-a'})])})
    renderWithApp(<QueuePage navigate={vi.fn()}/>)
    await screen.findByRole('table');await userEvent.click(screen.getByRole('button',{name:'Lotes'}));await userEvent.click(screen.getByRole('button',{name:'Ver lote completo'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.query',expect.objectContaining({batchId:'batch-a',page:1})))
  })
  it('links a published video to exact publication history in the Library',async()=>{
    const navigate=vi.fn()
    mockBridge({'jobs.query':()=>paged([job({state:'done',publishedVideo:{assetId:'a',name:'Vídeo específico'}})])})
    renderWithApp(<QueuePage navigate={navigate}/>)
    expect(await screen.findByText('Vídeo específico')).toBeInTheDocument()
    await menu('j1');await userEvent.click(screen.getByRole('button',{name:'Ver vídeo na Biblioteca'}))
    expect(navigate).toHaveBeenCalledWith('library');expect(takeLibraryFocus(WS_ID)).toMatchObject({publicationJobId:'j1'})
  })
})
