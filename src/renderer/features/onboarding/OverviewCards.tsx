import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatQuotaWindow } from '@shared/quota'
import type { DashboardSummary } from '@shared/types'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Badge, Button } from '../../components/ui'
import { Progress } from '../../components/ui/Progress'
import { LegacyMascot } from '../../components/brand/LegacyMascot'
import type { PageKey } from '../../routes'

/** Greeting with the next concrete step: the next scheduled Container, or how to create one. */
export function WelcomeCard({ data, status, mascotState, navigate }: { data: DashboardSummary; status: string; mascotState: Parameters<typeof LegacyMascot>[0]['state']; navigate(p: PageKey): void }) {
  const { workspace } = useWorkspace()
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: workspace.timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: workspace.timeZone, hour: '2-digit', minute: '2-digit' })
  const next = data.nextContainer
  return <section aria-label="Boas-vindas" className="brand-welcome min-h-44">
    <div className="grid gap-2">
      <h2>Olá{data.quota ? `, @${data.quota.username}` : ''}</h2>
      {next?.plannedStartAt ? <>
        <p className="text-base text-fg">Próximo Container: <strong>{next.name}</strong></p>
        <p>{when(next.plannedStartAt)}{next.plannedEndAt ? ` → ${time(next.plannedEndAt)}` : ''}</p>
        <div className="mt-2 flex flex-wrap gap-2"><Button variant="primary" onClick={() => navigate('calendar')}>Abrir calendário</Button><Button onClick={() => navigate('queue')}>Ver fila</Button></div>
      </> : <>
        <p className="text-base text-fg">Nenhum Container agendado.</p>
        <p>Selecione vídeos na Biblioteca, crie um Container e agende em uma janela de pico.</p>
        <div className="mt-2 flex flex-wrap gap-2"><Button variant="primary" onClick={() => navigate('library')}>Abrir biblioteca</Button><Button onClick={() => navigate('profiles')}>Acompanhar um perfil</Button></div>
      </>}
      <p className="brand-live-status" aria-live="polite">{status}</p>
    </div>
    <LegacyMascot size={132} state={mascotState} interactive decorative />
  </section>
}

/** Publishing limit as Meta reported it; unknown stays unknown, never an invented number. */
export function QuotaCard({ data, navigate }: { data: DashboardSummary; navigate(p: PageKey): void }) {
  const { workspace } = useWorkspace(), qc = useQueryClient()
  const q = data.quota
  const refresh = useMutation({ mutationFn: (accountId: string) => call('quota.refresh', { workspaceId: workspace.id, accountId, slots: [] }), onSettled: () => void qc.invalidateQueries({ queryKey: ['dashboard', workspace.id] }) })
  const known = q && q.usage !== null && q.total !== null && q.durationSec !== null
  return <section aria-label="Quota de publicação" className="flex min-h-44 flex-col justify-between gap-3 rounded-card border border-line bg-panel p-5">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Quota do Instagram</h2>{q && <Badge tone={q.freshness === 'fresh' ? 'success' : 'default'}>{q.freshness === 'fresh' ? 'Atualizada' : q.freshness === 'stale' ? 'Desatualizada' : 'Sem leitura'}</Badge>}</div>
    {!q ? <><p className="text-xs text-dim">Conecte uma conta para acompanhar o limite de publicações.</p><Button size="sm" onClick={() => navigate('accounts')}>Conectar conta</Button></>
      : known ? <div className="grid gap-2">
        <p className="text-2xl font-semibold tabular-nums">{q.usage} <span className="text-sm font-normal text-dim">de {q.total}</span></p>
        <Progress value={q.usage! / q.total! * 100} label="Uso da quota" />
        <p className="text-xs text-dim">Publicações de @{q.username} nas últimas {formatQuotaWindow(q.durationSec!)}, segundo a Meta{q.fetchedAt ? ` · consulta de ${new Date(q.fetchedAt).toLocaleString('pt-BR', { timeZone: workspace.timeZone, dateStyle: 'short', timeStyle: 'short' })}` : ''}.</p>
      </div>
        : <p className="text-xs text-dim">A quota de @{q.username} ainda não foi consultada. O limite e a janela vêm da Meta.</p>}
    {q && <QuotaRefresh username={q.username} pending={refresh.isPending} error={refresh.isError} onRefresh={id => refresh.mutate(id)} />}
  </section>
}

function QuotaRefresh({ username, pending, error, onRefresh }: { username: string; pending: boolean; error: boolean; onRefresh(id: string): void }) {
  const { workspace } = useWorkspace()
  return <div className="flex items-center justify-between gap-2">
    {error ? <span role="alert" className="text-xs text-danger-fg">Não foi possível consultar a Meta.</span> : <span />}
    <Button size="sm" disabled={pending} onClick={async () => { const a = await call('accounts.instagram', { workspaceId: workspace.id }); if (a?.username === username) onRefresh(a.id) }}>{pending ? 'Consultando…' : 'Atualizar quota'}</Button>
  </div>
}
