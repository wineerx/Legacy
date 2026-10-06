import { useQuery } from '@tanstack/react-query'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button } from '../../components/ui'
import type { PageProps } from '../../routes'

const stateLabel = { queued: 'Na fila', running: 'Em execução', done: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada' }
const fmt = (v: number | null) => v === null ? '—' : v.toLocaleString('pt-BR')

export function DashboardWidgets({ navigate }: PageProps) {
  const { workspace, workerAlive } = useWorkspace()
  const query = useQuery({ queryKey: ['dashboard', workspace.id], queryFn: () => call('dashboard.get', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const data = query.data
  if (query.isError) return <section role="alert" className="rounded-card border border-line p-4"><p>Não foi possível carregar os indicadores.</p><Button onClick={() => void query.refetch()}>Atualizar indicadores</Button></section>
  if (!data) return <p role="status" className="text-sm text-dim">Carregando tarefas e métricas…</p>
  const cards = [
    { title: 'Tarefas na fila', value: data.tasks.queued, note: `${data.tasks.running} em execução`, page: 'queue' as const },
    { title: 'Concluídas', value: data.tasks.done, note: `${data.tasks.total} tarefas no histórico`, page: 'queue' as const },
    { title: 'Falhas', value: data.tasks.failed, note: 'Precisam de atenção', page: 'queue' as const },
    { title: 'Perfis', value: data.profiles.length, note: 'Neste workspace', page: 'profiles' as const },
    { title: 'Vídeos guardados', value: data.library.count, note: `${(data.library.bytes / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB na biblioteca`, page: 'library' as const },
    { title: 'Não lidas', value: data.unread, note: 'Central de notificações', page: 'notifications' as const }
  ]
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between text-xs text-dim"><span>{workerAlive ? 'Processador online' : 'Processador indisponível'}</span><span>Atualização a cada 5 segundos</span></div>
    <div data-tour="dashboard" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{cards.map((c) => <button type="button" key={c.title} onClick={() => navigate(c.page)} className="rounded-card border border-line bg-panel p-4 text-left hover:border-line-strong"><p className="text-xs text-dim">{c.title}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{fmt(c.value)}</p><p className="mt-1 text-[11px] text-dim">{c.note}</p></button>)}</div>
    <section data-tour="profile-metrics" className="rounded-card border border-line bg-panel p-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Métricas dos perfis</h2><Button size="sm" onClick={() => navigate('profiles')}>Abrir perfis</Button></div>
      <p className="mt-1 text-xs text-dim">Soma dos valores disponíveis nos posts carregados. Não representa o alcance total da conta. Dados ausentes aparecem como —.</p>
      {!data.profiles.length ? <p className="mt-4 text-sm text-dim">Adicione um perfil e busque reels ou importe métricas para acompanhar os resultados.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-dim"><tr><th className="pb-2 pr-4">Perfil</th><th className="pb-2 pr-4">Baixados / posts</th><th className="pb-2 pr-4">Visualizações</th><th className="pb-2 pr-4">Curtidas</th><th className="pb-2 pr-4">Comentários</th><th className="pb-2">Atualização das métricas</th></tr></thead><tbody>{data.profiles.map((p) => <tr key={p.id} className="border-t border-line">
        <td className="py-3 pr-4 font-medium">@{p.username}</td><td className="py-3 pr-4 tabular-nums">{p.downloaded} / {p.posts}</td>
        {(['views', 'likes', 'comments'] as const).map((key) => <td key={key} className="py-3 pr-4 tabular-nums"><span>{fmt(p[key])}</span><span className="block text-[10px] text-dim">{p[`${key}Known`]} de {p.posts} posts</span></td>)}
        <td className="py-3 text-xs text-dim">{p.metricsUpdatedAt ? new Date(p.metricsUpdatedAt).toLocaleString('pt-BR', { timeZone: workspace.timeZone }) : 'Sem sincronização'}</td>
      </tr>)}</tbody></table></div>}
    </section>
    <section className="rounded-card border border-line bg-panel p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Atividade recente</h2><Button size="sm" onClick={() => navigate('queue')}>Abrir fila</Button></div>
      {!data.recent.length ? <p className="mt-3 text-sm text-dim">Nenhuma tarefa registrada.</p> : <ul className="mt-3 divide-y divide-line">{data.recent.map((j) => <li key={j.id} className="flex items-center justify-between gap-4 py-2 text-sm"><span className="min-w-0 truncate" title={j.label}>{j.label}</span><span className={`shrink-0 text-xs ${j.state === 'failed' ? 'text-danger-fg' : 'text-dim'}`}>{stateLabel[j.state]}</span></li>)}</ul>}
    </section>
  </div>
}
