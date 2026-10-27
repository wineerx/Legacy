/**
 * Servidor MCP do Legacy (stdio). Fala só com o bridge local do app aberto (src/main/ipc/mcp-bridge.ts):
 * não abre o SQLite, não vê credenciais e herda a validação zod e o escopo de workspace do IPC.
 * Executar: node mcp/legacy-mcp.ts (Node 24 remove os tipos sem flag).
 */
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const dataDir = process.env.LEGACY_DATA_DIR ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Legacy')
type Bridge = { port: number; token: string }
type Account = { id: string; username: string; revision: string; validatedAt: string }
type AudioTrack = { sha256: string; ext: string; name: string; durationMs: number }

async function bridge(): Promise<Bridge> {
  try { return JSON.parse(await readFile(join(dataDir, 'mcp-bridge.json'), 'utf8')) as Bridge }
  catch { throw new Error('O Legacy não está aberto neste computador. Abra o app e tente de novo.') }
}

function invoke<T = any>(channel: string, input: unknown = {}): Promise<T> {
  return bridge().then(info => new Promise<T>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: info.port, method: 'POST', path: '/invoke', timeout: 120_000,
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' } }, res => {
      let text = ''
      res.setEncoding('utf8'); res.on('data', c => { text += c })
      res.on('end', () => {
        try {
          const body = JSON.parse(text)
          if (body.ok) resolve(body.data as T); else reject(new Error(body.error?.message ?? 'Falha no Legacy.'))
        } catch { reject(new Error('Resposta inválida do Legacy.')) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('O Legacy demorou para responder.')))
    req.on('error', () => reject(new Error('O Legacy não respondeu. Abra o app e tente de novo.')))
    req.end(JSON.stringify({ channel, input }))
  }))
}

async function workspace(id?: string): Promise<string> {
  if (id) return id
  const boot = await invoke<{ workspaces: { id: string }[] }>('app.bootstrap')
  if (!boot.workspaces.length) throw new Error('Nenhum workspace encontrado no Legacy.')
  return boot.workspaces[0].id
}

async function account(ws: string, id?: string): Promise<Account> {
  const accounts = await invoke<Account[]>('accounts.instagramList', { workspaceId: ws })
  if (id) {
    const found = accounts.find(a => a.id === id)
    if (!found) throw new Error(`Conta ${id} não conectada. Contas disponíveis: ${accounts.map(a => `@${a.username} (${a.id})`).join(', ') || 'nenhuma'}.`)
    return found
  }
  if (accounts.length === 1) return accounts[0]
  if (!accounts.length) throw new Error('Nenhuma conta do Instagram conectada. Conecte uma conta no Legacy.')
  throw new Error(`Há mais de uma conta conectada. Informe contaId: ${accounts.map(a => `@${a.username} (${a.id})`).join(', ')}.`)
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try { return json(await fn(args)) }
    catch (e) { return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] } }
  }
}

const workspaceId = z.string().uuid().optional().describe('Workspace. Omitido: o primeiro workspace do app.')
const containerRef = { workspaceId, containerId: z.string().uuid(), revision: z.number().int().min(1).describe('revision atual do lote, retornada por legacy_ver_lote ou legacy_criar_lote') }
const trial = { nao: null, manual: 'MANUAL', desempenho: 'SS_PERFORMANCE' } as const

const server = new McpServer({ name: 'legacy', version: '0.1.0' }, {
  instructions: 'Legacy é o estúdio local de vídeos da pessoa. Fluxo para programar vídeos: legacy_importar_videos (ou legacy_listar_videos) → legacy_importar_audio se houver faixa → legacy_criar_lote (rascunho, sem envio) → mostrar o resumo à pessoa → legacy_agendar_lote somente depois de um sim explícito. Agendar cria publicações reais no Instagram.'
})

server.registerTool('legacy_status', {
  description: 'Estado do Legacy: workspaces, sessão, worker e contas do Instagram conectadas.',
  inputSchema: { workspaceId }, annotations: { readOnlyHint: true }
}, tool(async (a: { workspaceId?: string }) => {
  const boot = await invoke('app.bootstrap'), session = await invoke('session.get')
  const ws = a.workspaceId ?? boot.workspaces[0]?.id
  return { version: boot.version, workspaces: boot.workspaces, sessionEntered: session.entered, workerAlive: boot.workerAlive,
    ...(ws && session.entered ? { queue: await invoke('jobs.health', { workspaceId: ws }), accounts: await invoke('accounts.instagramList', { workspaceId: ws }) } : {}) }
}))

server.registerTool('legacy_listar_contas', {
  description: 'Lista as contas do Instagram conectadas, com id e revision usados no agendamento.',
  inputSchema: { workspaceId }, annotations: { readOnlyHint: true }
}, tool(async (a: { workspaceId?: string }) => invoke('accounts.instagramList', { workspaceId: await workspace(a.workspaceId) })))

server.registerTool('legacy_listar_videos', {
  description: 'Lista vídeos da Biblioteca (mais recentes primeiro). Use o assetId retornado em legacy_criar_lote.',
  inputSchema: { workspaceId, texto: z.string().max(100).optional(), status: z.enum(['ready', 'processing', 'scheduled', 'published', 'failed', 'unpublished']).optional(),
    limite: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) },
  annotations: { readOnlyHint: true }
}, tool(async (a: { workspaceId?: string; texto?: string; status?: string; limite: number; offset: number }) => {
  const page = await invoke('grid.query', { workspaceId: await workspace(a.workspaceId), source: 'library', sortBy: 'importedAt', sortDir: 'desc', mediaKind: 'videos',
    limit: a.limite, offset: a.offset, ...(a.texto ? { text: a.texto } : {}), ...(a.status ? { status: a.status } : {}) })
  return { total: page.total, items: page.items.map((v: any) => ({ assetId: v.assetId ?? v.id, nome: v.filePath ? String(v.filePath).split(/[\\/]/).pop() : null,
    duracaoMs: v.durationMs ?? null, status: v.status ?? null, importadoEm: v.importedAt ?? null, publicadoEm: v.publishedAccounts ?? [], metricas: v.metrics })) }
}))

server.registerTool('legacy_importar_videos', {
  description: 'Importa vídeos do disco para a Biblioteca (caminhos absolutos no Windows). O original não é alterado. Retorna o assetId de cada arquivo.',
  inputSchema: { workspaceId, caminhos: z.array(z.string().min(1).max(1024)).min(1).max(200) }
}, tool(async (a: { workspaceId?: string; caminhos: string[] }) => invoke('library.importPaths', { workspaceId: await workspace(a.workspaceId), paths: a.caminhos })))

server.registerTool('legacy_importar_audio', {
  description: 'Importa uma faixa de áudio (MP3, M4A, AAC ou WAV) para usar em lotes. Retorna o sha256 que identifica a faixa.',
  inputSchema: { workspaceId, caminho: z.string().min(1).max(1024) }
}, tool(async (a: { workspaceId?: string; caminho: string }) => invoke('audio.importPath', { workspaceId: await workspace(a.workspaceId), path: a.caminho })))

server.registerTool('legacy_listar_audios', {
  description: 'Lista as faixas de áudio já importadas.',
  inputSchema: { workspaceId }, annotations: { readOnlyHint: true }
}, tool(async (a: { workspaceId?: string }) => invoke('audio.list', { workspaceId: await workspace(a.workspaceId) })))

const loteInput = {
  workspaceId,
  nome: z.string().trim().min(1).max(120),
  contaId: z.string().regex(/^\d+$/).optional().describe('Conta do Instagram. Omitida: a única conta conectada.'),
  videos: z.array(z.object({ assetId: z.string().min(1).max(64), legenda: z.string().max(2200).optional().describe('Legenda só deste vídeo. Omitida: legendaBase.') })).min(1).max(1000),
  legendaBase: z.string().max(2200).default(''),
  inicio: z.string().datetime({ offset: true }).describe('Primeira publicação, ISO-8601 com fuso. Ex.: 2026-10-27T18:00:00-03:00'),
  intervaloMin: z.number().int().min(15).max(10080).default(60),
  reelsTeste: z.enum(['nao', 'manual', 'desempenho']).default('nao').describe('Reels de teste: manual = a pessoa decide se gradua; desempenho = a Meta gradua pelo desempenho.'),
  audio: z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    modo: z.enum(['substituir', 'mixar']).default('substituir').describe('substituir remove o som original; mixar mantém o som original sob a faixa.'),
    volume: z.number().min(0).max(200).optional().describe('Volume da faixa em %. Padrão: 100 ao substituir, 30 ao mixar.'),
    volumeOriginal: z.number().min(0).max(200).default(100),
    inicioMs: z.number().int().min(0).default(0).describe('Ponto da faixa onde o vídeo começa.')
  }).optional(),
  compartilharNoFeed: z.boolean().default(true),
  permitirRepost: z.boolean().default(false)
}
type LoteInput = { workspaceId?: string; nome: string; contaId?: string; videos: { assetId: string; legenda?: string }[]; legendaBase: string; inicio: string; intervaloMin: number;
  reelsTeste: keyof typeof trial; audio?: { sha256: string; modo: 'substituir' | 'mixar'; volume?: number; volumeOriginal: number; inicioMs: number }; compartilharNoFeed: boolean; permitirRepost: boolean }

server.registerTool('legacy_criar_lote', {
  description: 'Cria um lote (Container) em RASCUNHO com um ou mais vídeos, legenda por vídeo, Reels de teste e faixa de áudio opcionais. Não publica nem processa nada. Retorna horários, cota e avisos para revisar com a pessoa antes de legacy_agendar_lote.',
  inputSchema: loteInput
}, tool(async (a: LoteInput) => {
  const ws = await workspace(a.workspaceId), acc = await account(ws, a.contaId)
  let audio: Record<string, unknown> | undefined
  if (a.audio) {
    const tracks = await invoke<AudioTrack[]>('audio.list', { workspaceId: ws }), t = tracks.find(v => v.sha256 === a.audio!.sha256)
    if (!t) throw new Error('Faixa de áudio não encontrada. Importe com legacy_importar_audio.')
    audio = { enabled: true, sha256: t.sha256, ext: t.ext, name: t.name, mode: a.audio.modo === 'mixar' ? 'mix' : 'replace',
      volumePct: a.audio.volume ?? (a.audio.modo === 'mixar' ? 30 : 100), originalVolumePct: a.audio.volumeOriginal, startMs: a.audio.inicioMs }
  }
  const draft = { name: a.nome, provider: 'instagram', destinationAccountId: acc.id, accountRevision: acc.revision, plannedStartAt: a.inicio, intervalMin: a.intervaloMin,
    trialGraduation: trial[a.reelsTeste], captionBase: a.legendaBase, visualSnapshot: { version: 1, ...(audio ? { audio } : {}) },
    items: a.videos.map(v => ({ assetId: v.assetId, captionOverride: v.legenda ?? null, shareToFeed: a.compartilharNoFeed, allowRepost: a.permitirRepost })) }
  const detail = await invoke('containers.create', { workspaceId: ws, requestId: randomUUID(), draft })
  const slots = a.videos.map((_, i) => new Date(Date.parse(a.inicio) + i * a.intervaloMin * 60_000).toISOString())
  const [quota, reposts] = await Promise.all([
    invoke('quota.get', { workspaceId: ws, accountId: acc.id, slots }).catch((e: Error) => ({ status: 'unknown', reason: e.message })),
    invoke('publications.checkRepost', { workspaceId: ws, accountId: acc.id, assetIds: a.videos.map(v => v.assetId) }).catch(() => [])
  ])
  return {
    containerId: detail.container.id, revision: detail.container.revision, estado: detail.container.state, conta: `@${acc.username}`,
    reelsTeste: a.reelsTeste, audio: audio ? { nome: audio.name, modo: a.audio!.modo, volume: audio.volumePct } : null,
    itens: detail.items.map((item: any, i: number) => ({ posicao: i + 1, assetId: item.assetId, nome: item.source?.name, publicarEm: slots[i], legenda: item.captionOverride ?? a.legendaBase })),
    cota: { status: quota.status, disponivelAgora: quota.availableNow ?? null, motivo: quota.reason ?? null },
    avisosRepost: reposts,
    proximoPasso: 'Mostre este resumo à pessoa. Só chame legacy_agendar_lote com containerId e revision depois de um sim explícito.'
  }
}))

server.registerTool('legacy_agendar_lote', {
  description: 'Agenda um lote em rascunho: cria as publicações reais no Instagram nos horários do lote. Chame somente depois que a pessoa confirmar o resumo de legacy_criar_lote nesta conversa.',
  inputSchema: containerRef, annotations: { destructiveHint: true, openWorldHint: true }
}, tool(async (a: { workspaceId?: string; containerId: string; revision: number }) => {
  const r = await invoke('containers.schedule', { workspaceId: await workspace(a.workspaceId), containerId: a.containerId, expectedRevision: a.revision })
  return { containerId: r.detail.container.id, revision: r.detail.container.revision, estado: r.detail.container.state,
    inicio: r.detail.container.plannedStartAt, fim: r.detail.container.plannedEndAt, publicacoes: r.jobs.map((j: any) => ({ jobId: j.id, quando: j.runAt, estado: j.state })) }
}))

server.registerTool('legacy_ver_lote', {
  description: 'Detalha um lote: estado, revision, itens, legendas efetivas e situação de cada publicação.',
  inputSchema: { workspaceId, containerId: z.string().uuid(), pagina: z.number().int().min(1).default(1) }, annotations: { readOnlyHint: true }
}, tool(async (a: { workspaceId?: string; containerId: string; pagina: number }) => invoke('containers.get', { workspaceId: await workspace(a.workspaceId), containerId: a.containerId, page: a.pagina, pageSize: 50 })))

server.registerTool('legacy_listar_lotes', {
  description: 'Lista os lotes (Containers) com estado e contagens.',
  inputSchema: { workspaceId, estado: z.enum(['draft', 'scheduled', 'in_progress', 'paused', 'completed', 'completed_with_failures', 'cancelled']).optional(), pagina: z.number().int().min(1).default(1) },
  annotations: { readOnlyHint: true }
}, tool(async (a: { workspaceId?: string; estado?: string; pagina: number }) => {
  const page = await invoke('containers.query', { workspaceId: await workspace(a.workspaceId), page: a.pagina, pageSize: 50, ...(a.estado ? { state: a.estado } : {}) })
  return { total: page.total, lotes: page.items.map((c: any) => ({ containerId: c.id, nome: c.name, estado: c.state, revision: c.revision, inicio: c.plannedStartAt, fim: c.plannedEndAt, reelsTeste: c.trialGraduation, contagens: c.counts })) }
}))

for (const [name, channel, description] of [
  ['legacy_pausar_lote', 'containers.pause', 'Pausa as publicações pendentes de um lote agendado.'],
  ['legacy_retomar_lote', 'containers.resume', 'Retoma um lote pausado.'],
  ['legacy_cancelar_lote', 'containers.cancel', 'Cancela um lote. Publicações já enviadas ao Instagram não são desfeitas. Confirme com a pessoa antes.']
] as const) {
  server.registerTool(name, { description, inputSchema: containerRef, annotations: { destructiveHint: channel === 'containers.cancel' } },
    tool(async (a: { workspaceId?: string; containerId: string; revision: number }) => {
      const d = await invoke(channel, { workspaceId: await workspace(a.workspaceId), containerId: a.containerId, expectedRevision: a.revision })
      return { containerId: d.container.id, revision: d.container.revision, estado: d.container.state, contagens: d.container.counts }
    }))
}

server.registerTool('legacy_status_fila', {
  description: 'Lista tarefas da fila (publicações, processamento), com estado, horário e último erro.',
  inputSchema: { workspaceId, estado: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']).optional(), pagina: z.number().int().min(1).default(1) },
  annotations: { readOnlyHint: true }
}, tool(async (a: { workspaceId?: string; estado?: string; pagina: number }) => invoke('jobs.query', { workspaceId: await workspace(a.workspaceId), page: a.pagina, pageSize: 50, search: '', ...(a.estado ? { state: a.estado } : {}) })))

await server.connect(new StdioServerTransport())
