import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Copy,
  Download,
  Globe,
  ListOrdered,
  Pause,
  Play,
  Terminal,
  Trash2,
} from 'lucide-react'
import {
  groupEvents,
  sanitize,
  type DiagnosticEvent,
} from '@shared/diagnostics'
import { call } from '../lib/api'
import { useWorkspace } from '../lib/workspace'
import { focusQueueTask } from '../lib/selection'
import type { PageKey } from '../routes'
import { LegacyMascot } from './brand/LegacyMascot'
import { useMascot } from './brand/MascotProvider'
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Tooltip,
  cx,
  useToast,
} from './ui'
import {
  ScrollArea,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from './ui/DiagnosticPrimitives'
import './diagnostics.css'

const tabs = [
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'network', label: 'Network', icon: Globe },
  { id: 'problems', label: 'Problemas', icon: CircleAlert },
  { id: 'queue', label: 'Fila', icon: ListOrdered },
  { id: 'processor', label: 'Processador', icon: Activity },
]
const providers = ['Todos', 'Legacy', 'Instagram', 'TikTok', 'Apify']
const tone = (level: string) =>
  level === 'ERROR' || level === 'FATAL'
    ? 'text-danger-fg'
    : level === 'WARN'
      ? 'text-warn'
      : level === 'SUCCESS'
        ? 'text-ok'
        : 'text-dim'
function problemCategory(e: DiagnosticEvent) {
  if (/duplic/i.test(e.message)) return 'Duplicidades'
  if (/import/i.test(e.endpoint ?? '') || /import/i.test(e.message))
    return 'Erros de importação'
  if (e.taskId && e.provider === 'Instagram') return 'Falhas de publicação'
  if (e.source === 'worker' || e.source === 'processor')
    return 'Problemas de processamento'
  if (e.source === 'network') return 'Erros de API'
  if (e.level === 'WARN') return 'Warnings'
  return 'Inconsistências / erros'
}
function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(`legacy.diagnostics.${key}`) ?? fallback
  } catch {
    return fallback
  }
}
function persist(key: string, value: string) {
  try {
    localStorage.setItem(`legacy.diagnostics.${key}`, value)
  } catch {
    /* storage unavailable */
  }
}
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const pieces = text.split(
    new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
  )
  return (
    <>
      {pieces.map((piece, i) =>
        piece.toLowerCase() === query.toLowerCase() ? (
          <mark key={i}>{piece}</mark>
        ) : (
          piece
        ),
      )}
    </>
  )
}
function Filters({
  label,
  values,
  value,
  change,
}: {
  label: string
  values: string[]
  value: string
  change(v: string): void
}) {
  return (
    <div className="diagnostic-filters" role="group" aria-label={label}>
      {values.map((v) => (
        <Button
          key={v}
          size="sm"
          variant="ghost"
          aria-pressed={v === value}
          onClick={() => change(v)}
        >
          {v}
        </Button>
      ))}
    </div>
  )
}
export function DiagnosticPanel({
  navigate,
}: {
  navigate(page: PageKey): void
}) {
  const { workspace } = useWorkspace()
  const mascot = useMascot()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(() => stored('tab', 'console'))
  const [height, setHeight] = useState(() =>
    Math.max(200, Math.min(650, Number(stored('height', '320')) || 320)),
  )
  const [paused, setPaused] = useState(false),
    [autoScroll, setAutoScroll] = useState(true)
  const [query, setQuery] = useState(''),
    [match, setMatch] = useState(0)
  const [level, setLevel] = useState('Todos'),
    [provider, setProvider] = useState('Todos'),
    [status, setStatus] = useState('Todos')
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set())
  const [frozen, setFrozen] = useState<DiagnosticEvent[]>([])
  const [queuePage, setQueuePage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [consolePage,setConsolePage]=useState(0)
  const [occurrencePage,setOccurrencePage]=useState<Record<string,number>>({})
  const viewport = useRef<HTMLDivElement>(null)
  const snapshot = useQuery({
    queryKey: ['diagnostics', workspace.id],
    queryFn: () => call('diagnostics.snapshot', { workspaceId: workspace.id }),
    refetchInterval: 2000,
  })
  const pipeline=useQuery({queryKey:['pipeline-diagnostics',workspace.id],queryFn:()=>call('diagnostics.pipeline',{workspaceId:workspace.id}),enabled:open && tab==='processor',refetchInterval:open && tab==='processor'?5000:false})
  // The footer and mascot need the same counts. Share the existing observer;
  // only fetch the 100 detailed rows when that diagnostic tab is visible.
  const summary=useQuery({queryKey:['queue-summary',workspace.id],queryFn:()=>call('jobs.query',{workspaceId:workspace.id,page:1,pageSize:10,search:''}),refetchInterval:5000})
  const queue = useQuery({
    queryKey: ['diagnostic-queue', workspace.id, queuePage],
    queryFn: () =>
      call('diagnostics.queue', { workspaceId: workspace.id, page: queuePage }),
    enabled: open && tab==='queue',
    refetchInterval: open && tab==='queue' ? 5000 : false,
  })
  const allEvents = snapshot.data?.events ?? []
  const events = (paused ? frozen : allEvents).filter(
    (e) => !clearedIds.has(e.id),
  )
  const groups = useMemo(() => open && tab==='console' ? groupEvents(events) : [], [events,open,tab])
  const filtered = groups.filter(
    ({ event: e }) =>
      (provider === 'Todos' || e.provider === provider) &&
      (level === 'Todos' ||
        (level === 'Info' && ['INFO', 'DEBUG', 'SUCCESS'].includes(e.level)) ||
        (level === 'Warnings' && e.level === 'WARN') ||
        (level === 'Errors' && ['ERROR', 'FATAL'].includes(e.level))),
  )
  const matches = query ? filtered.flatMap((g, i) =>
    JSON.stringify(g.occurrences).toLowerCase().includes(query.toLowerCase()) &&
    query
      ? [i]
      : [],
  ) : []
  const currentMatch = matches.length ? match % matches.length : 0
  const lastConsolePage=Math.max(0,Math.floor((filtered.length-1)/25))
  const displayedConsolePage=query && matches.length?Math.floor(matches[currentMatch]/25):autoScroll && !paused?lastConsolePage:Math.min(consolePage,lastConsolePage)
  const visibleGroups=filtered.slice(displayedConsolePage*25,(displayedConsolePage+1)*25).map((g,index)=>({g,i:displayedConsolePage*25+index}))
  useEffect(() => {
    setMatch(0)
    setOccurrencePage({})
  }, [query, level, provider])
  useEffect(()=>{setOccurrencePage(current=>{
    if(!Object.keys(current).length)return current
    const ids=new Set((paused?frozen:allEvents).map(e=>e.id))
    return Object.keys(current).some(id=>!ids.has(id))?Object.fromEntries(Object.entries(current).filter(([id])=>ids.has(id))):current
  })},[allEvents,paused,frozen])
  useEffect(() => {
    if (!open || tab !== 'console' || !viewport.current) return
    if (query && matches.length)
      viewport.current
        .querySelector(`[data-row="${matches[currentMatch]}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    else if (autoScroll && !paused)
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [
    snapshot.data,
    open,
    tab,
    query,
    currentMatch,
    autoScroll,
    paused,
    level,
    provider,
  ])
  useEffect(() => {
    const onResize = () =>
      setHeight((h) => Math.min(h, Math.max(200, window.innerHeight - 160)))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const alive = snapshot.data?.workerAlive ?? mascot.workerAlive
  const heartbeat = snapshot.data?.heartbeat
  const stale = !heartbeat || Date.now() - Date.parse(heartbeat) > 10000
  const problems = events.filter((e) =>
    ['ERROR', 'FATAL', 'WARN'].includes(e.level),
  )
  const issueGroups = groupEvents(problems).sort((a, b) =>
    problemCategory(a.event).localeCompare(problemCategory(b.event)),
  )
  const failedJobs =
    snapshot.data?.failedJobs.filter(
      (j) => j.state === 'failed' && !problems.some((e) => e.taskId === j.id),
    ) ?? []
  const problemCount = issueGroups.length + failedJobs.length
  const counts = summary.data?.counts
  const workerState =
    !alive || stale
      ? 'Offline'
      : allEvents.some(
            (e) =>
              ['worker', 'processor'].includes(e.source) &&
              e.level === 'FATAL' &&
              Date.now() - Date.parse(e.timestamp) < 60000,
          )
        ? 'Erro'
        : mascot.running
          ? 'Processando'
          : (counts?.failed ?? 0) > 0
            ? 'Atenção'
            : 'Saudável'
  const footerMessage = !alive
    ? 'Processador desconectado.'
    : mascot.state === 'error'
      ? 'Algo deu errado.'
      : mascot.running
        ? `Processando ${mascot.running} tarefa(s)...`
        : workerState === 'Atenção'
          ? 'Algumas tarefas precisam de atenção.'
          : 'Tudo funcionando normalmente.'
  const network = events.filter(
    (e) =>
      ['network', 'ipc'].includes(e.source) &&
      (provider === 'Todos' || e.provider === provider) &&
      (status === 'Todos' ||
        (status === 'Falhas' && (e.level === 'ERROR' || e.level === 'FATAL')) ||
        (status === 'Lentos' && (e.duration ?? 0) > 3000) ||
        (status === '2xx' &&
          (e.statusCode ?? 0) >= 200 &&
          (e.statusCode ?? 0) < 300) ||
        (status === '4xx' &&
          (e.statusCode ?? 0) >= 400 &&
          (e.statusCode ?? 0) < 500) ||
        (status === '5xx' && (e.statusCode ?? 0) >= 500)),
  )
  function openTask(id: string) {
    focusQueueTask(workspace.id, id)
    navigate('queue')
  }
  function resize(next: number) {
    const h = Math.round(
      Math.max(200, Math.min(window.innerHeight - 160, next)),
    )
    setHeight(h)
    persist('height', String(h))
  }
  const payload = (queueData: unknown = queue.data) =>
    JSON.stringify(
      sanitize({
        version: 1,
        exportedAt: new Date().toISOString(),
        workspaceId: workspace.id,
        retention:
          'Últimos 2000 eventos da sessão; limpar afeta apenas a visualização',
        events,
        queue: queueData,
        stages: snapshot.data?.stages,
        worker: { alive, heartbeat, state: workerState },
      }),
      null,
      2,
    )
  async function copy() {
    try {
      await navigator.clipboard.writeText(payload())
      toast.show({ title: 'Diagnóstico copiado.' })
    } catch {
      toast.show({
        title: 'Não foi possível copiar o diagnóstico.',
        tone: 'error',
      })
    }
  }
  async function exportLog() {
    setExporting(true)
    try {
      const result = await call('diagnostics.export', {
        workspaceId: workspace.id,
      })
      if (result.saved) toast.show({ title: 'Diagnóstico exportado.' })
    } catch {
      toast.show({
        title: 'Não foi possível exportar o diagnóstico completo.',
        tone: 'error',
      })
    } finally {
      setExporting(false)
    }
  }
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { timeZone: workspace.timeZone })
  function details(e: DiagnosticEvent) {
    return (
      <pre className="diagnostic-details">
        <Highlight text={JSON.stringify(e, null, 2)} query={query} />
      </pre>
    )
  }
  const taskButton = (e: DiagnosticEvent) =>
    e.taskId ? (
      <Button size="sm" variant="ghost" onClick={() => openTask(e.taskId!)}>
        Abrir tarefa {e.taskId.slice(0, 8)}
      </Button>
    ) : null
  return (
    <footer className="diagnostic-footer">
      {open && (
        <div
          className="diagnostic-resize"
          role="separator"
          aria-label="Altura do painel técnico"
          aria-orientation="horizontal"
          aria-valuemin={200}
          aria-valuemax={Math.max(200, window.innerHeight - 160)}
          aria-valuenow={height}
          tabIndex={0}
          onKeyDown={(e) => {
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
              e.preventDefault()
              resize(
                e.key === 'Home'
                  ? 200
                  : e.key === 'End'
                    ? window.innerHeight - 160
                    : height + (e.key === 'ArrowUp' ? 20 : -20),
              )
            }
          }}
          onPointerDown={(e) => {
            const node = e.currentTarget
            node.setPointerCapture(e.pointerId)
            const y = e.clientY,
              h = height
            const move = (event: PointerEvent) => resize(h + y - event.clientY)
            const end = () => {
              node.removeEventListener('pointermove', move)
              node.removeEventListener('pointerup', end)
              node.removeEventListener('pointercancel', end)
            }
            node.addEventListener('pointermove', move)
            node.addEventListener('pointerup', end)
            node.addEventListener('pointercancel', end)
          }}
        >
          <span />
        </div>
      )}
      {open && (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value)
            persist('tab', value)
          }}
          className="diagnostic-panel"
          style={{ height, maxHeight: 'calc(100vh - 160px)' }}
        >
          <div className="diagnostic-heading">
            <TabsList aria-label="Diagnóstico técnico">
              {tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  <t.icon size={14} />
                  {t.label}
                  {t.id === 'problems' && problemCount > 0 && (
                    <Badge tone="error">{problemCount}</Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <Tooltip content="Recolher painel">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Recolher painel técnico"
                onClick={() => setOpen(false)}
                icon={<ChevronDown />}
              />
            </Tooltip>
          </div>
          <Separator />
          {snapshot.isError && (
            <p role="alert" className="diagnostic-notice text-danger-fg">
              Diagnóstico indisponível. Últimos dados preservados; aguardando
              reconexão.
            </p>
          )}
          <TabsContent value="console" className="diagnostic-content">
            <div className="diagnostic-toolbar">
              <div className="diagnostic-search">
                <Input
                  label="Buscar logs"
                  placeholder="Buscar logs..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setMatch((m) =>
                        matches.length
                          ? (m + (e.shiftKey ? -1 : 1) + matches.length) %
                            matches.length
                          : 0,
                      )
                    }
                  }}
                />
              </div>
              <span aria-live="polite" className="text-dim">
                {matches.length
                  ? `${currentMatch + 1} de ${matches.length}`
                  : '0 de 0'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Resultado anterior"
                disabled={!matches.length}
                icon={<ArrowUp />}
                onClick={() =>
                  setMatch((m) => (m - 1 + matches.length) % matches.length)
                }
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Próximo resultado"
                disabled={!matches.length}
                icon={<ArrowDown />}
                onClick={() => setMatch((m) => (m + 1) % matches.length)}
              />
              <div className="diagnostic-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={paused ? <Play /> : <Pause />}
                  aria-pressed={paused}
                  onClick={() => {
                    if (!paused) setFrozen(allEvents)
                    setPaused(!paused)
                  }}
                >
                  {paused ? 'Retomar' : 'Pausar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={autoScroll}
                  onClick={() => setAutoScroll(!autoScroll)}
                >
                  Auto-scroll
                </Button>
                <Tooltip content="Limpar apenas a visualização">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Limpar logs"
                    icon={<Trash2 />}
                    onClick={() =>
                      setClearedIds(new Set(allEvents.map((e) => e.id)))
                    }
                  />
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy />}
                  onClick={copy}
                >
                  Copiar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Download />}
                  disabled={exporting}
                  onClick={exportLog}
                >
                  {exporting ? 'Exportando...' : 'Exportar'}
                </Button>
              </div>
            </div>
            <div className="diagnostic-toolbar">
              <Filters
                label="Nível de log"
                values={['Todos', 'Info', 'Warnings', 'Errors']}
                value={level}
                change={setLevel}
              />
              <Filters
                label="Provider do console"
                values={providers}
                value={provider}
                change={setProvider}
              />
            </div>
            <ScrollArea ref={viewport} onWheel={() => setAutoScroll(false)}>
              <div className="diagnostic-log">
                {visibleGroups.map(({g,i}) => {
                  const occurrenceMatch=query?g.occurrences.findIndex(e=>JSON.stringify(e).toLowerCase().includes(query.toLowerCase())):-1
                  const occurrenceLast=Math.max(0,Math.floor((g.occurrences.length-1)/25))
                  const occurrenceCurrent=Math.min(occurrenceLast,occurrencePage[g.event.id]??(occurrenceMatch>=0?Math.floor((g.occurrences.length-1-occurrenceMatch)/25):0))
                  return (
                  <Collapsible
                    key={g.event.id}
                    open={
                      expanded.has(g.event.id) ||
                      Boolean(query && matches[currentMatch] === i)
                    }
                    onOpenChange={(value) =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (value) next.add(g.event.id)
                        else next.delete(g.event.id)
                        return next
                      })
                    }
                    className={cx(
                      'diagnostic-entry',
                      query &&
                        matches[currentMatch] === i &&
                        'diagnostic-current',
                    )}
                    data-row={i}
                  >
                    <CollapsibleTrigger className="diagnostic-line">
                      <span className="text-mute">
                        {time(g.event.timestamp)}
                      </span>
                      <span className={tone(g.event.level)}>
                        {g.event.level}
                      </span>
                      <span className="diagnostic-message">
                        <Highlight
                          text={`${g.event.provider ?? g.event.source} · ${g.event.message}${g.event.endpoint ? ` · ${g.event.method ?? ''} ${g.event.endpoint}` : ''}`}
                          query={query}
                        />
                      </span>
                      {g.occurrences.length > 1 && (
                        <Badge>× {g.occurrences.length}</Badge>
                      )}
                      <ChevronDown size={12} />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {(expanded.has(g.event.id) || Boolean(query && matches[currentMatch]===i)) && <>
                      {g.occurrences.slice(Math.max(0,g.occurrences.length-25-25*occurrenceCurrent),g.occurrences.length-25*occurrenceCurrent).map((e) => (
                        <div key={e.id}>
                          {details(e)}
                          {taskButton(e)}
                        </div>
                      ))}
                      {g.occurrences.length>25 && <div className="diagnostic-toolbar">
                        <Button size="sm" disabled={occurrenceCurrent>=occurrenceLast} onClick={()=>setOccurrencePage(p=>({...p,[g.event.id]:occurrenceCurrent+1}))}>Ocorrências anteriores</Button>
                        <span>{g.occurrences.length} ocorrências · até 25 por página</span>
                        <Button size="sm" disabled={!occurrenceCurrent} onClick={()=>setOccurrencePage(p=>({...p,[g.event.id]:Math.max(0,occurrenceCurrent-1)}))}>Ocorrências seguintes</Button>
                      </div>}
                      </>}
                    </CollapsibleContent>
                  </Collapsible>
                )})}
                {!filtered.length && (
                  <p className="diagnostic-empty">
                    Nenhum evento neste filtro. Os eventos reais aparecem
                    durante o uso do Legacy.
                  </p>
                )}
              </div>
            </ScrollArea>
            <div className="diagnostic-toolbar">
              <Button size="sm" disabled={displayedConsolePage===0 || Boolean(query && matches.length)} onClick={()=>{setAutoScroll(false);setConsolePage(displayedConsolePage-1)}}>Logs anteriores</Button>
              <span aria-live="polite">Página {displayedConsolePage+1} de {lastConsolePage+1} · {filtered.length} grupos</span>
              <Button size="sm" disabled={displayedConsolePage===lastConsolePage || Boolean(query && matches.length)} onClick={()=>{setAutoScroll(false);setConsolePage(displayedConsolePage+1)}}>Logs seguintes</Button>
            </div>
            <p className="diagnostic-caption">
              {paused
                ? 'Visualização pausada · captura continua'
                : 'Captura ativa'}{' '}
              · {events.length} eventos · {workspace.timeZone} · Enter /
              Shift+Enter navega · até 2000 eventos por sessão
            </p>
          </TabsContent>
          <TabsContent value="network" className="diagnostic-content">
            <div className="diagnostic-toolbar">
              <Filters
                label="Provider da rede"
                values={providers}
                value={provider}
                change={setProvider}
              />
              <Filters
                label="Status de rede"
                values={['Todos', '2xx', '4xx', '5xx', 'Falhas', 'Lentos']}
                value={status}
                change={setStatus}
              />
            </div>
            <ScrollArea>
              <div className="diagnostic-network-head">
                <span>Provider</span>
                <span>Request</span>
                <span>Status</span>
                <span>Tempo</span>
              </div>
              {network.map((e) => (
                <Collapsible key={e.id} className="diagnostic-entry">
                  <CollapsibleTrigger className="diagnostic-network-row">
                    <span>{e.provider}</span>
                    <span className="truncate">
                      {e.method} {e.endpoint}
                    </span>
                    <span className={tone(e.level)}>
                      {e.statusCode ??
                        (e.source === 'ipc'
                          ? e.level === 'ERROR'
                            ? 'Falha IPC'
                            : 'OK IPC'
                          : 'Falha')}
                    </span>
                    <span>{e.duration}ms</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {details(e)}
                    {taskButton(e)}
                  </CollapsibleContent>
                </Collapsible>
              ))}
              {!network.length && (
                <p className="diagnostic-empty">
                  Nenhuma chamada neste filtro.
                </p>
              )}
            </ScrollArea>
            <p className="diagnostic-caption">
              Lentos: acima de 3s · IPC não possui código HTTP · headers,
              parâmetros e corpos externos omitidos por segurança
            </p>
          </TabsContent>
          <TabsContent value="problems" className="diagnostic-content">
            <div className="diagnostic-toolbar">
              <Badge tone="error">
                {issueGroups.filter((g) => g.event.level !== 'WARN').length +
                  failedJobs.length}{' '}
                Errors
              </Badge>
              <Badge>
                {issueGroups.filter((g) => g.event.level === 'WARN').length}{' '}
                Warnings
              </Badge>
            </div>
            <ScrollArea>
              {issueGroups.map((g, index) => (
                <Fragment key={g.event.id}>
                  {(index === 0 ||
                    problemCategory(issueGroups[index - 1].event) !==
                      problemCategory(g.event)) && (
                    <h3 className="diagnostic-caption">
                      {problemCategory(g.event)}
                    </h3>
                  )}
                  <Collapsible className="diagnostic-entry">
                    <CollapsibleTrigger className="diagnostic-problem">
                      <CircleAlert size={14} className={tone(g.event.level)} />
                      <span>{g.event.message}</span>
                      <Badge>{g.occurrences.length}</Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="diagnostic-caption">
                        {g.event.source === 'network'
                          ? 'Falhas de API'
                          : /import/i.test(g.event.endpoint ?? '')
                            ? 'Erros de importação'
                            : /duplic/i.test(g.event.message)
                              ? 'Duplicidades'
                              : g.event.provider === 'Instagram'
                                ? 'Falhas de publicação'
                                : g.event.source === 'worker'
                                  ? 'Problemas de processamento'
                                  : 'Inconsistências / operação'}
                      </p>
                      {g.occurrences.map((e) => (
                        <div key={e.id}>
                          {taskButton(e)}
                          {details(e)}
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                </Fragment>
              ))}
              {failedJobs.map((j) => (
                <div key={j.id} className="diagnostic-problem">
                  <CircleAlert size={14} className="text-danger-fg" />
                  <span>{String(sanitize(j.lastError ?? j.label))}</span>
                  <Button size="sm" onClick={() => openTask(j.id)}>
                    Abrir tarefa
                  </Button>
                </div>
              ))}
              {!problemCount && (
                <p className="diagnostic-empty">Nenhum problema registrado.</p>
              )}
            </ScrollArea>
            <p className="diagnostic-caption">
              Ocorrências da sessão e últimas 500 falhas persistidas · abra a
              tarefa para vídeo, perfil e etapa.
            </p>
          </TabsContent>
          <TabsContent value="queue" className="diagnostic-content">
            <div className="diagnostic-toolbar">
              <Badge tone={alive ? 'success' : 'error'}>
                Processador: {alive ? 'ativo' : 'offline'}
              </Badge>
              {counts &&
                Object.entries({
                  'Em execução': counts.running,
                  'Na fila': counts.queued,
                  Concluídas: counts.done,
                  Falhas: counts.failed,
                  Retry: snapshot.data?.retryCount ?? 0,
                }).map(([label, n]) => (
                  <span key={label}>
                    {label} <strong>{n}</strong>
                  </span>
                ))}
            </div>
            <ScrollArea>
              {queue.data?.items.map((j) => (
                <div key={j.id} className="diagnostic-job">
                  <span className="truncate">{String(sanitize(j.label))}</span>
                  <Badge
                    tone={
                      j.state === 'failed'
                        ? 'error'
                        : j.state === 'done'
                          ? 'success'
                          : 'default'
                    }
                  >
                    {snapshot.data?.stages[j.id] ??
                      (j.state === 'queued'
                        ? j.attempts > 0
                          ? 'Retrying'
                          : 'Queued'
                        : j.state === 'running'
                          ? 'Processing'
                          : j.state === 'done'
                            ? j.type === 'publish_instagram'
                              ? 'Confirmed'
                              : 'Completed'
                            : j.state === 'failed'
                              ? 'Failed'
                              : 'Cancelled')}
                  </Badge>
                  <span className="text-dim">
                    {j.attempts}/{j.maxAttempts}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openTask(j.id)}
                  >
                    {j.id.slice(0, 8)} ↗
                  </Button>
                </div>
              ))}
              {queue.isError && (
                <p role="alert" className="diagnostic-empty text-danger-fg">
                  Não foi possível consultar a fila. Nenhuma conclusão foi
                  inferida.
                </p>
              )}
              {queue.data && !queue.data.items.length && (
                <p className="diagnostic-empty">Fila vazia.</p>
              )}
            </ScrollArea>
            <div className="diagnostic-toolbar">
              <Button
                size="sm"
                disabled={queuePage === 1}
                onClick={() => setQueuePage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span>
                Página {queuePage} · {queue.data?.total ?? '…'} tarefas
              </span>
              <Button
                size="sm"
                disabled={!queue.data || queuePage * 100 >= queue.data.total}
                onClick={() => setQueuePage((p) => p + 1)}
              >
                Próxima
              </Button>
              <span className="text-dim">
                Checkpoints reais · sucesso exige confirmação
              </span>
            </div>
          </TabsContent>
          <TabsContent value="processor" className="diagnostic-content">
            <ScrollArea>
              <div className="diagnostic-health">
                <p
                  className={
                    workerState === 'Offline' || workerState === 'Erro'
                      ? 'text-danger-fg'
                      : workerState === 'Atenção'
                        ? 'text-warn'
                        : 'text-ok'
                  }
                >
                  ● {workerState}
                </p>
                <dl>
                  {pipeline.data && Object.entries({
                    'Jobs/min':pipeline.data.queue.jobsPerMinute,
                    'Jobs/h':pipeline.data.queue.jobsPerHour,
                    'Fila vencida':pipeline.data.queue.due,
                    'Atraso mais antigo':`${Math.round(pipeline.data.queue.lagMs/1000)} s`,
                    'Slots ocupados':`${pipeline.data.workers.busy}/${pipeline.data.workers.capacity}`,
                    'DLQ':pipeline.data.queue.dlq,
                    'DB':`${pipeline.data.resources.dbLatencyMs.toFixed(1)} ms`,
                    'RSS main':`${Math.round(pipeline.data.resources.rssBytes/1048576)} MB`
                  }).map(([label,v])=><div key={label}><dt>{label}</dt><dd>{v}</dd></div>)}
                  {Object.entries({
                    Heartbeat: heartbeat
                      ? `${Math.max(0, Math.floor((Date.now() - Date.parse(heartbeat)) / 1000))}s atrás`
                      : 'Aguardando heartbeat',
                    'Última tarefa': [...allEvents]
                      .reverse()
                      .find((e) => e.source === 'worker')?.timestamp
                      ? time(
                          [...allEvents]
                            .reverse()
                            .find((e) => e.source === 'worker')!.timestamp,
                        )
                      : 'Sem registro nesta sessão',
                    Fila: counts?.queued ?? '…',
                    'Falhas recentes (5 min)': allEvents.filter(
                      (e) =>
                        e.source === 'worker' &&
                        ['ERROR', 'FATAL'].includes(e.level) &&
                        Date.now() - Date.parse(e.timestamp) < 300000,
                    ).length,
                    'Latência média': (() => {
                      const requests = allEvents.filter(
                        (e) =>
                          e.source === 'network' && e.duration !== undefined,
                      )
                      return requests.length
                        ? `${Math.round(requests.reduce((n, e) => n + e.duration!, 0) / requests.length)}ms`
                        : 'Sem amostras'
                    })(),
                  }).map(([label, v]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                {pipeline.data?.health.map(h=><p key={h.component} title={h.detail}>{h.component}: {h.state}{!h.applicable?' (não utilizado)':''}</p>)}
                {pipeline.data && <dl>{Object.entries(pipeline.data.latencies).map(([name,value])=><div key={name}><dt>{name} ({value.samples} amostras)</dt><dd>p50 {value.ms.p50.toFixed(0)} · p95 {value.ms.p95.toFixed(0)} · p99 {value.ms.p99.toFixed(0)} ms</dd></div>)}</dl>}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      )}
      <Separator />
      <div className="diagnostic-status">
        <Tooltip content={mascot.message}>
          <span>
            <LegacyMascot state={mascot.state} size={28} decorative />
          </span>
        </Tooltip>
        <span className="diagnostic-brand">
          <strong>Legacy</strong>
          <span className="truncate" title={mascot.message}>
            {footerMessage}
          </span>
        </span>
        <span className="diagnostic-worker">
          <i
            className={cx(
              'size-1.5 rounded-full',
              alive ? 'bg-ok' : 'bg-danger',
            )}
          />
          {alive ? 'Processador ativo' : 'Processador desconectado'}
        </span>
        <span className="text-dim">
          {mascot.running} em execução · {mascot.queued} na fila
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            aria-expanded={open}
            icon={open ? <ChevronDown /> : <ChevronUp />}
            onClick={() => setOpen((v) => !v)}
          >
            Diagnóstico
            {problemCount > 0 && <Badge tone="error">{problemCount}</Badge>}
          </Button>
        </div>
      </div>
    </footer>
  )
}
