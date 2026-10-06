import type { Channel } from '@shared/ipc-contract'
import type { MascotState } from './LegacyMascot'

export type MascotSignal = { state: MascotState; message: string }
const operations: Partial<Record<Channel, MascotSignal>> = {
  'library.pickAndImport': { state: 'question', message: 'Escolha os vídeos para importar.' },
  'library.importPaths': { state: 'working', message: 'Importando e validando vídeos.' },
  'profiles.add': { state: 'working', message: 'Cadastrando o perfil.' },
  'profiles.discover': { state: 'searching', message: 'Solicitando a busca de posts.' },
  'profiles.download': { state: 'searching', message: 'Preparando a busca de vídeos do perfil.' },
  'profiles.downloadSelected': { state: 'downloading', message: 'Preparando os downloads selecionados.' },
  'profiles.prepareSelected': { state: 'working', message: 'Preparando as mídias selecionadas.' },
  'profiles.importMetricsFile': { state: 'thinking', message: 'Importando e analisando métricas.' },
  'profiles.scheduleInstagram': { state: 'working', message: 'Salvando o agendamento no Legacy.' },
  'accounts.connectInstagram': { state: 'searching', message: 'Verificando a conta do Instagram.' },
  'accounts.verifyInstagram': { state: 'searching', message: 'Consultando a conta do Instagram.' },
  'versions.saveCover': { state: 'working', message: 'Salvando a capa.' },
  'versions.requestBanner': { state: 'working', message: 'Preparando o banner.' },
  'versions.prepareVideo': { state: 'working', message: 'Preparando capa e banner no vídeo.' },
  'export.tiktok': { state: 'working', message: 'Preparando arquivos para postagem manual no TikTok.' },
}
type ActivityEvent = { id: number; workspaceId: string; signal: MascotSignal; phase: 'start' | 'end'; outcome?: 'finished' | 'error' | 'warning' | 'cancelled'; message?: string }
const listeners = new Set<(event: ActivityEvent) => void>()
const active = new Map<number, ActivityEvent>()
let sequence = 0
export function subscribeActivity(listener: (event: ActivityEvent) => void) {
  listeners.add(listener)
  active.forEach(listener)
  return () => { listeners.delete(listener) }
}
export function beginActivity(channel: Channel, workspaceId?: string) {
  const signal = operations[channel]
  if (!signal || !workspaceId) return () => {}
  const event = { id: ++sequence, workspaceId, signal }
  const timer = setTimeout(() => {
    const started: ActivityEvent = { ...event, phase: 'start' }
    active.set(event.id, started)
    listeners.forEach(fn => fn(started))
  }, 180)
  return (outcome: ActivityEvent['outcome'], message?: string) => {
    clearTimeout(timer)
    active.delete(event.id)
    listeners.forEach(fn => fn({ ...event, phase: 'end', outcome, message }))
  }
}
