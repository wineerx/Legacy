import { takeLibraryFocus } from '../../lib/selection'
import { describe, it, expect, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { QueuePage } from './QueuePage'

const job = (over: object) => ({ id: 'j1', workspaceId: WS_ID, type: 'export_tiktok', state: 'queued', attempts: 0, maxAttempts: 5, batchId: null, account: null, runAt: '2026-10-05T12:00:00.000Z', lastError: null, label: 'Exportar 2 vídeo(s) para TikTok', createdAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z', ...over })

const paged = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25, counts: { queued: 1, running: 0, failed: 1, done: 0, cancelled: 0 } })

describe('QueuePage', () => {
  it('lista com rótulos e cancela job na fila', async () => {
    const invoke = mockBridge({
      'jobs.query': () => paged([job({}), job({ id: 'j2', state: 'failed', attempts: 5, lastError: 'Processamento falhou (código 1)' })]),
      'jobs.cancel': () => true, 'jobs.retry': () => true
    })
    renderWithApp(<QueuePage navigate={vi.fn()} />)
    await screen.findAllByText('Exportar 2 vídeo(s) para TikTok')
    const rows = screen.getAllByRole('article')
    expect(within(rows[0]).getByText('Na fila')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Falhou')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Processamento falhou (código 1)')).toBeInTheDocument()
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }))
    expect(invoke).toHaveBeenCalledWith('jobs.cancel', { workspaceId: WS_ID, id: 'j1' })
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Tentar de novo' }))
    expect(invoke).toHaveBeenCalledWith('jobs.retry', { workspaceId: WS_ID, id: 'j2' })
  })

  it('estado vazio', async () => {
    mockBridge({ 'jobs.query': () => paged([]) })
    renderWithApp(<QueuePage navigate={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Nada na fila' })).toBeInTheDocument()
  })

  it('falha ao cancelar mostra toast de erro', async () => {
    mockBridge({ 'jobs.query': () => paged([job({})]), 'jobs.cancel': () => { throw { code: 'internal', message: 'Job já iniciou.' } } })
    renderWithApp(<QueuePage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível cancelar')
    expect(alert).toHaveTextContent('Job já iniciou.')
  })

  it('pagina no backend e preserva os filtros na próxima página', async()=>{
    const invoke=mockBridge({'jobs.query': i=>({...paged([job({})]),total:60,page:i.page,pageSize:i.pageSize})})
    renderWithApp(<QueuePage navigate={vi.fn()}/> )
    await screen.findByText(/60 tarefas/)
    await userEvent.click(screen.getByLabelText('Tipo'))
    await userEvent.click(await screen.findByRole('option',{name:'Publicação Instagram'}))
    await userEvent.click(screen.getByRole('button',{name:'Próxima'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.query',expect.objectContaining({page:2,type:'publish_instagram'})))
    await userEvent.type(screen.getByLabelText('Buscar tarefa ou conta'),'teste')
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.query',expect.objectContaining({page:1,search:'teste',type:'publish_instagram'})))
  })

  it('realoca falha somente após revisar data, destino e confirmar', async()=>{
    const runAt=new Date(Date.now()+32*86400000).toISOString()
    const invoke=mockBridge({'jobs.query':()=>paged([job({state:'failed'})]),'jobs.tail':()=>({runAt,ahead:3}),'jobs.reschedule':()=>true})
    renderWithApp(<QueuePage navigate={vi.fn()}/> )
    await userEvent.click(await screen.findByRole('button',{name:'Passar a vez'}))
    await screen.findByText('3 tarefas pendentes antes do horário sugerido.')
    await userEvent.click(screen.getByLabelText('Data'))
    expect(screen.getByText(new Date(runAt).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}))).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(invoke.mock.calls.some(([channel])=>channel==='jobs.reschedule')).toBe(false)
    await userEvent.click(screen.getByRole('button',{name:'Confirmar novo horário'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.reschedule',expect.objectContaining({workspaceId:WS_ID,id:'j1',expectedUpdatedAt:'2026-10-05T12:00:00.000Z'})))
  })

  it('agrupa lotes e consulta todos os itens ao expandir o lote', async()=>{
    const invoke=mockBridge({'jobs.query':()=>paged([job({batchId:'batch-a'}),job({id:'j2',batchId:'batch-a'})])})
    renderWithApp(<QueuePage navigate={vi.fn()}/> )
    await screen.findAllByRole('article')
    await userEvent.click(screen.getByRole('button',{name:'Árvore de lotes'}))
    await userEvent.click(screen.getByRole('button',{name:'Ver lote completo'}))
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('jobs.query',expect.objectContaining({batchId:'batch-a',page:1})))
  })
})

it('identifica o vídeo publicado e abre um filtro exato na Biblioteca', async () => {
 const navigate=vi.fn()
 mockBridge({'jobs.query':()=>({items:[{id:'published-job',workspaceId:WS_ID,type:'publish_instagram',state:'done',attempts:1,maxAttempts:24,label:'Publicar Reel',runAt:new Date().toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),batchId:null,account:'destino',lastError:null,publishedVideo:{assetId:'a',name:'Vídeo específico'}}],total:1,page:1,pageSize:25,counts:{done:1,queued:0,running:0,failed:0,cancelled:0}})})
 renderWithApp(<QueuePage navigate={navigate}/>)
 expect(await screen.findByText('Publicado: Vídeo específico')).toBeInTheDocument()
 await userEvent.click(screen.getByRole('button',{name:'Ver vídeo na Biblioteca'}))
 expect(navigate).toHaveBeenCalledWith('library')
 expect(takeLibraryFocus(WS_ID)).toMatchObject({publicationJobId:'published-job'})
})
