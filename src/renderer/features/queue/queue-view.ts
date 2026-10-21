import type { JobView } from '@shared/types'
export const STATES = { queued: { label: 'Na fila', tone: 'queued' }, running: { label: 'Em execução', tone: 'running' }, done: { label: 'Concluída', tone: 'done' }, failed: { label: 'Falhou', tone: 'failed' }, cancelled: { label: 'Cancelada', tone: 'cancelled' } }
export const TYPES = { make_thumbnail: 'Miniatura', apply_banner: 'Edição', export_tiktok: 'Exportação TikTok', fetch_profile: 'Busca de perfil', download_reel: 'Download', webhook_delivery: 'Webhook', publish_instagram: 'Publicação Instagram' }
export const PLATFORMS = { instagram: 'Instagram', tiktok: 'TikTok', local: 'Local', webhook: 'Webhook' }
export const PRIORITIES = ['Normal', 'Alta', 'Urgente']
export function stage(job: JobView, now: number) {
  return job.context?.stage ?? (job.state === 'queued' && Date.parse(job.runAt) > now ? 'Agendada' : STATES[job.state].label)
}
export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min` : seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}` : `${seconds}s`
}
export function nextAction(message: string, code?: string | null) {
  const text = `${code ?? ''} ${message}`.toLowerCase()
  if (/publication_quota|2207042|limite de publica/.test(text)) return 'A publicação será retomada automaticamente quando houver cota. O horário exibido é uma estimativa.'
  if (/token|autentica|conectada|oauth|permiss|forbidden/.test(text)) return 'Revise a conexão e as permissões em Contas antes de repetir.'
  if (/429|rate.limit|limite de requisi/.test(text)) return 'Aguarde o limite do provider liberar e reagende a tarefa.'
  if (/removid|not_found|arquivo|invalid_media/.test(text)) return 'Confira a mídia de origem na Biblioteca antes de repetir.'
  if (/confirma|incerta|contêiner|container|publica/.test(text)) return 'Confira o destino antes de repetir. O checkpoint remoto será preservado.'
  return 'Revise o erro e a origem. Tente novamente quando a causa estiver resolvida.'
}
