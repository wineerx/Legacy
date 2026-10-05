import type { JobView } from '@shared/types'
import type { MascotState } from './LegacyMascot'
import type { MascotSignal } from './activity'

export const statePriority: Partial<Record<MascotState, number>> = {
  error: 100, approval: 95, question: 90, rate_limit: 85, warning: 80,
  publishing: 75, upload: 74, downloading: 73, working: 70, searching: 65, thinking: 60,
  waiting: 50, offline: 45, finished: 40, proud: 35, notification: 30,
  greeting: 20, wink: 15, surprised: 15, idle: 0, sleeping: -1,
}
export function dominantSignal(signals: MascotSignal[]): MascotSignal {
  return signals.reduce((best, value) => (statePriority[value.state] ?? 0) > (statePriority[best.state] ?? 0) ? value : best)
}
export function isRateLimit(message: string): boolean {
  return /HTTP\s*429\b|\brate_limit\b|\btoo many requests\b|limite temporário da plataforma/i.test(message)
}
export function processorSignal(workerAlive: boolean, jobs: JobView[] | undefined, queryFailed = false, now = Date.now()): MascotSignal {
  if (!workerAlive) return { state: 'error', message: 'Processador reiniciando. As tarefas aguardam sua recuperação.' }
  if (queryFailed) return { state: 'error', message: 'Não foi possível consultar a fila. Confira a conexão com o processador.' }
  if (!jobs) return { state: 'thinking', message: 'Consultando o estado do processador.' }
  const signals: MascotSignal[] = []
  for (const job of jobs) {
    if (job.state === 'failed') {
      signals.push({ state: isRateLimit(job.lastError ?? '') ? 'rate_limit' : 'error', message: `${job.label}: ${job.lastError ?? 'A tarefa falhou.'} Confira a Fila para tentar novamente.` })
    } else if (job.state === 'running') {
      signals.push({ state: job.type === 'publish_instagram' ? 'publishing' : job.type === 'fetch_profile' ? 'searching' : job.type === 'download_reel' ? 'downloading' : 'working', message: job.label })
    } else if (job.state === 'queued' && job.lastError) {
      const retry = new Date(job.runAt).getTime()
      const when = Number.isFinite(retry) && retry > now ? ` Próxima tentativa às ${new Date(retry).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : ' Aguardando nova tentativa do processador.'
      signals.push({ state: isRateLimit(job.lastError) ? 'rate_limit' : 'waiting', message: `${job.lastError}${when}` })
    } else if (job.state === 'queued' && new Date(job.runAt).getTime() <= now) {
      signals.push({ state: 'waiting', message: 'Há tarefas prontas, aguardando o processador.' })
    }
  }
  if (signals.length) return dominantSignal(signals)
  const scheduled = jobs.filter(job => job.state === 'queued').length
  return { state: 'idle', message: scheduled ? `${scheduled} tarefa(s) agendada(s). Nenhuma em execução agora.` : 'Sua fila está vazia. Tudo pronto para começar.' }
}

export function resolveMascotState(workerAlive: boolean, jobs: JobView[] | undefined, queryFailed = false): MascotState {
  return processorSignal(workerAlive, jobs, queryFailed).state
}
