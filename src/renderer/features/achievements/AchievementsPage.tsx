import { useQuery } from '@tanstack/react-query'
import { Flame, Trophy, CheckCircle2, PlayCircle } from 'lucide-react'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button } from '../../components/ui'
import type { PageProps } from '../../routes'

export function AchievementsPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const result = useQuery({ queryKey: ['achievements', workspace.id], queryFn: () => call('achievements.get', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const history = useQuery({ queryKey: ['publications', workspace.id], queryFn: () => call('publications.history', { workspaceId: workspace.id }) })
  return <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-6 p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><Trophy size={22} />Desafios e conquistas</h1><p className="mt-1 text-sm text-dim">Progresso real, um dia de cada vez.</p></div><Button onClick={() => navigate('profiles')}>Escolher próximo vídeo</Button></header>
    {result.isError && <p role="alert">Não foi possível carregar o progresso.</p>}
    <section className="rounded-card border border-line bg-panel p-5"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Flame size={20} />Ofensiva diária</h2><p className="mb-4 text-xs text-dim">Uma publicação confirmada por dia, por conta · {workspace.timeZone}. Exportações e tarefas agendadas não contam.</p>
      {!result.data?.streaks.length && <p className="text-sm text-dim">Sua primeira publicação confirmada inicia a ofensiva.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{result.data?.streaks.map(s => <article key={s.username} className="rounded-ctl border border-line p-4"><strong>@{s.username}</strong><p className="my-2 text-2xl font-semibold">{s.current} dias</p><p className="text-xs text-dim">Recorde: {s.best} · {s.today ? 'Meta de hoje concluída' : 'Publique hoje para continuar'}</p></article>)}</div>
    </section>
    <section aria-label="Desafios" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{result.data?.challenges.map(c => <article key={c.id} className="rounded-card border border-line bg-panel p-5"><div className="mb-3 flex items-center justify-between"><Trophy size={20} className={c.unlocked ? 'text-success' : 'text-dim'} />{c.unlocked && <CheckCircle2 size={18} aria-label="Conquistado" />}</div><h2 className="font-semibold">{c.title}</h2><p className="mt-1 min-h-10 text-xs text-dim">{c.description}</p><progress aria-label={c.title} max={c.target} value={c.current} className="mt-4 h-2 w-full accent-white" /><p className="mt-1 text-xs text-dim">{c.current.toLocaleString('pt-BR')} / {c.target.toLocaleString('pt-BR')}</p></article>)}</section>
    <section className="rounded-card border border-line p-5"><h2 className="mb-3 font-semibold">Histórico de publicações</h2><p className="mb-3 text-xs text-dim">Mantido mesmo quando a cópia local é apagada.</p>{history.isError && <p role="alert">Não foi possível carregar o histórico.</p>}{!history.data?.length && <p className="text-sm text-dim">Nenhuma publicação confirmada.</p>}<ul className="divide-y divide-line">{history.data?.slice(0, 100).map(h => {
      const p = JSON.parse(h.provenanceJson)
      const states: Record<string, string> = { kept: 'Vídeo mantido', deleted: 'Cópia local apagada', kept_in_use: 'Mantido: outra tarefa usa este vídeo', no_local_copy: 'Sem cópia local', cleanup_failed: 'Limpeza falhou; publicação concluída', pending: 'Limpeza pendente' }
      return <li key={h.jobId} className="flex flex-wrap items-center gap-3 py-3 text-sm"><PlayCircle size={16} /><div className="min-w-0 flex-1"><strong>@{h.username}</strong><p className="truncate text-xs text-dim">Origem: {p.profile ? `@${p.profile}` : '—'} · {new Date(h.publishedAt).toLocaleString('pt-BR', { timeZone: workspace.timeZone })}</p></div><span className="text-xs text-dim">{states[h.cleanupState] ?? h.cleanupState}</span><Button size="sm" onClick={() => navigate('queue')}>Ver tarefa</Button></li>
    })}</ul></section>
  </div>
}
