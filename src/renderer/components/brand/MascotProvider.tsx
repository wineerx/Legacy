import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '../../lib/workspace'
import { call, onEvent } from '../../lib/api'
import { subscribeActivity, type MascotSignal } from './activity'
import { dominantSignal, isRateLimit, processorSignal } from './status'

type Value = MascotSignal & {
  progress: number; running: number; queued: number; unread: number; workerAlive: boolean
  react(): void; celebrate(message: string): void
  register(id: symbol, signal: MascotSignal | null): void
}
const Context = createContext<Value>({ state: 'idle', message: 'Legacy', progress: 0, running: 0, queued: 0, unread: 0, workerAlive: true, react() {}, celebrate() {}, register() {} })
export const useMascot = () => useContext(Context)
export const SLEEP_AFTER_MS = 120_000

export function MascotProvider({ children }: { children: ReactNode }) {
  const { workspace, workerAlive } = useWorkspace()
  const jobs = useQuery({ queryKey: ['jobs', workspace.id], queryFn: () => call('jobs.list', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const summary = useQuery({ queryKey: ['queue-summary', workspace.id], queryFn: () => call('jobs.query', { workspaceId: workspace.id, page: 1, pageSize: 10, search: '' }), refetchInterval: 5000 })
  const notes = useQuery({ queryKey: ['notifications', workspace.id], queryFn: () => call('notifications.list', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const [signals, setSignals] = useState<Map<symbol | number, MascotSignal>>(() => new Map())
  const [pulse, setPulse] = useState<(MascotSignal & { until: number }) | null>({ state: 'greeting', message: 'Bem-vindo ao Legacy.', until: Date.now() + 1000 })
  const [sleeping, setSleeping] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [, tick] = useState(0)
  const lastInteraction = useRef(0)
  const greeted = useRef(false)
  const completed = useRef(new Set<string>())
  const pendingCompletion = useRef(false)
  const currentJobs = useRef(jobs.data)
  currentJobs.current = jobs.data
  const previousJobs = useRef(new Map<string, string>())
  const previousNotes = useRef<Set<string> | null>(null)
  const emit = useCallback((signal: MascotSignal, duration: number) => {
    setPulse(current => current && current.until > Date.now() && dominantSignal([current, signal]) === current ? current : { ...signal, until: Date.now() + duration })
  }, [])
  useEffect(() => {
    if (!pulse) return
    const timer = setTimeout(() => setPulse(null), Math.max(0, pulse.until - Date.now()))
    return () => clearTimeout(timer)
  }, [pulse])
  const finish = useCallback((id: string) => {
    if (completed.current.has(id)) return
    completed.current.add(id)
    if (completed.current.size > 500) completed.current.delete(completed.current.values().next().value!)
    pendingCompletion.current = true
    if (!currentJobs.current?.some(job => job.state === 'running')) {
      pendingCompletion.current = false
      emit({ state: 'finished', message: 'Tarefa concluída.' }, 650)
    }
  }, [emit])
  useEffect(() => onEvent('jobs.changed', payload => {
    const event = payload as { workspaceId?: string; jobId?: string; state?: string } | null
    if (event?.workspaceId === workspace.id && event.state === 'done' && event.jobId) finish(event.jobId)
  }), [workspace.id, finish])
  useEffect(() => {
    if (!jobs.data) return
    for (const job of jobs.data) {
      const before = previousJobs.current.get(job.id)
      if (job.state === 'done' && (before === 'running' || before === 'queued')) finish(job.id)
    }
    previousJobs.current = new Map(jobs.data.map(job => [job.id, job.state]))
    if (pendingCompletion.current && !jobs.data.some(job => job.state === 'running')) {
      pendingCompletion.current = false
      emit({ state: 'finished', message: 'Tarefa concluída.' }, 650)
    }
  }, [jobs.data, finish, emit])
  useEffect(() => {
    if (!notes.data) return
    if (previousNotes.current && notes.data.some(note => !note.readAt && !previousNotes.current!.has(note.id))) emit({ state: 'notification', message: 'Uma nova notificação chegou à central.' }, 900)
    previousNotes.current = new Set(notes.data.map(note => note.id))
  }, [notes.data, emit])
  useEffect(() => subscribeActivity(event => {
    if (event.workspaceId !== workspace.id) return
    setSignals(current => { const next = new Map(current); if (event.phase === 'start') next.set(event.id, event.signal); else next.delete(event.id); return next })
    if (event.phase === 'end' && event.outcome !== 'cancelled') {
      const state = event.outcome === 'error' && isRateLimit(event.message ?? '') ? 'rate_limit' : event.outcome ?? 'finished'
      emit({ state, message: event.message ?? 'Operação concluída.' }, state === 'finished' ? 650 : 6000)
    }
  }), [workspace.id, emit])
  const running = summary.data?.counts?.running ?? jobs.data?.filter(job => job.state === 'running').length ?? 0
  const busy = running > 0 || signals.size > 0
  useEffect(() => {
    let asleep = false
    let timer: ReturnType<typeof setTimeout>
    let lastReset = 0
    setSleeping(false)
    const reset = () => {
      const now = Date.now()
      if (asleep) { asleep = false; setSleeping(false); emit({ state: 'greeting', message: 'Bom ter você de volta.' }, 900) }
      if (now - lastReset < 1000) return
      lastReset = now
      clearTimeout(timer)
      if (!busy) timer = setTimeout(() => { asleep = true; setSleeping(true) }, SLEEP_AFTER_MS)
    }
    reset()
    window.addEventListener('pointermove', reset, { passive: true })
    window.addEventListener('keydown', reset)
    window.addEventListener('pointerdown', reset, { passive: true })
    return () => { clearTimeout(timer); window.removeEventListener('pointermove', reset); window.removeEventListener('keydown', reset); window.removeEventListener('pointerdown', reset) }
  }, [busy, emit])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    const due = jobs.data?.filter(job => job.state === 'queued').map(job => new Date(job.runAt).getTime()).filter(time => time > Date.now()).sort((a, b) => a - b)[0]
    if (!due) return
    const timer = setTimeout(() => tick(n => n + 1), Math.min(due - Date.now() + 10, 2_147_483_647))
    return () => clearTimeout(timer)
  }, [jobs.data])
  const register = useCallback((id: symbol, signal: MascotSignal | null) => setSignals(current => { const next = new Map(current); if (signal) next.set(id, signal); else next.delete(id); return next }), [])
  const react = useCallback(() => {
    if (Date.now() - lastInteraction.current < 7000) return
    lastInteraction.current = Date.now()
    emit({ state: greeted.current ? 'wink' : 'greeting', message: '' }, 900)
    greeted.current = true
  }, [emit])
  const celebrate = useCallback((message: string) => emit({ state: 'proud', message }, 1600), [emit])
  const processor = processorSignal(workerAlive, jobs.data, jobs.isError)
  if (processor.state === 'idle' && summary.data?.counts) processor.message = summary.data.counts.queued ? `${summary.data.counts.queued} tarefa(s) agendada(s). Nenhuma em execução agora.` : processor.message
  const primary = dominantSignal([processor, ...signals.values(), ...(pulse ? [pulse] : []), ...(!online ? [{ state: 'offline' as const, message: 'O sistema informa que está sem rede. Operações locais continuam disponíveis.' }] : [])])
  const state = primary.state === 'idle' && sleeping ? 'sleeping' : primary.state
  const value = useMemo(() => ({ progress: summary.data?.counts && summary.data.total ? summary.data.counts.done / summary.data.total * 100 : 0, state, message: primary.message || processor.message, running, queued: summary.data?.counts?.queued ?? jobs.data?.filter(job => job.state === 'queued').length ?? 0, unread: notes.data?.filter(note => !note.readAt).length ?? 0, workerAlive, react, celebrate, register }), [summary.data, state, primary.message, processor.message, running, jobs.data, notes.data, workerAlive, react, celebrate, register])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useMascotSignal(active: boolean, state: MascotSignal['state'], message: string) {
  const { register } = useMascot()
  const id = useRef(Symbol('mascot-signal'))
  useEffect(() => {
    if (!active) return
    const key = id.current
    register(key, { state, message })
    return () => register(key, null)
  }, [active, state, message, register])
}
