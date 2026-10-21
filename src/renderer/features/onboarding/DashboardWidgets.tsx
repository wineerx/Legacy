import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Film, HardDrive, ListOrdered, Send, Upload, Users } from 'lucide-react'
import type { DashboardAnalytics, DashboardSummary } from '@shared/types'
import { call, mediaUrl } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Card, CardBody, CardHeader, Segmented, StatusBadge, type Tone } from '../../components/ui'
import { BarChart, ChartLegend, DeltaBadge, DonutChart, LineChart, Meter, PipelineList, Sparkline, StatCard, compact, delta } from '../../components/charts/Charts'
import { TYPES } from '../queue/queue-view'
import type { PageProps } from '../../routes'

const stateLabel = { queued: 'Na fila', running: 'Em execução', done: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada' }
const stateTone: Record<keyof typeof stateLabel, Tone> = { queued: 'blue', running: 'orange', done: 'green', failed: 'red', cancelled: 'neutral' }
const ORIGINS: Record<DashboardAnalytics['origins'][number]['origin'], string> = { pc: 'Computador', ig_own: 'Instagram próprio', ig_third_party: 'Instagram', tiktok_third_party: 'TikTok', link_ref: 'Links' }
const EMPTY: DashboardAnalytics = { activity: [], origins: [], jobTypes: [], topPosts: [], accounts: [] }
const fmt = (v: number | null) => v === null ? '—' : v.toLocaleString('pt-BR')
const sum = (rows: DashboardAnalytics['activity'], key: 'published' | 'imported' | 'failed') => rows.reduce((s, r) => s + r[key], 0)
const dayLabel = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`
/** Engagement only when both sides are known: (likes + comments) / views. */
const engagement = (p: DashboardSummary['profiles'][number]) => p.views && p.likes !== null && p.comments !== null ? (p.likes + p.comments) / p.views * 100 : null

type Range = '7' | '14'

export function DashboardWidgets({ navigate }: PageProps) {
  const { workspace, workerAlive } = useWorkspace()
  const query = useQuery({ queryKey: ['dashboard', workspace.id], queryFn: () => call('dashboard.get', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const [range, setRange] = useState<Range>('14')
  const data = query.data
  const a = data?.analytics ?? EMPTY
  const { last, previous } = useMemo(() => ({ last: a.activity.slice(-7), previous: a.activity.slice(-14, -7) }), [a.activity])
  if (query.isError) return <section role="alert" className="rounded-card border border-line p-4"><p>Não foi possível carregar os indicadores.</p><Button onClick={() => void query.refetch()}>Atualizar indicadores</Button></section>
  if (!data) return <p role="status" className="text-sm text-dim">Carregando tarefas e métricas…</p>
  const shown = range === '7' ? last : a.activity
  const sources = a.origins.map(o => ({ key: o.origin, label: ORIGINS[o.origin], value: o.count })).sort((x, y) => y.value - x.value)
  const knownViews = data.profiles.reduce((s, p) => s + (p.views ?? 0), 0)
  const anyViews = data.profiles.some(p => p.views !== null)
  const doneTotal = a.jobTypes.reduce((s, t) => s + t.done, 0), failTotal = a.jobTypes.reduce((s, t) => s + t.failed, 0)
  const successRate = doneTotal + failTotal ? Math.round(doneTotal / (doneTotal + failTotal) * 100) : null

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-dim">
      <span className="flex items-center gap-2"><StatusBadge dot tone={workerAlive ? 'green' : 'red'}>{workerAlive ? 'Processador online' : 'Processador indisponível'}</StatusBadge>Atualização a cada 5 segundos</span>
      <span className="flex items-center gap-1.5"><CalendarDays size={13} aria-hidden />Últimos {range} dias · {workspace.timeZone}</span>
    </div>

    <div data-tour="dashboard" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard title="Publicações (7 dias)" value={fmt(sum(last, 'published'))} badge={<DeltaBadge value={delta(sum(last, 'published'), sum(previous, 'published'))} />} note="Comparado aos 7 dias anteriores" footer="Ver fila" onClick={() => navigate('queue')} label="Publicações nos últimos 7 dias">
        <div className="mt-3"><Sparkline values={last.map(d => d.published)} label="Publicações por dia" width={180} /></div>
      </StatCard>
      <StatCard title="Importações (7 dias)" value={fmt(sum(last, 'imported'))} badge={<DeltaBadge value={delta(sum(last, 'imported'), sum(previous, 'imported'))} />} note={`${fmt(data.library.count)} vídeos guardados`} footer="Abrir biblioteca" onClick={() => navigate('library')} label="Importações nos últimos 7 dias">
        <div className="mt-3"><Sparkline values={last.map(d => d.imported)} label="Importações por dia" width={180} /></div>
      </StatCard>
      <StatCard title="Tarefas na fila" value={fmt(data.tasks.queued)} icon={<ListOrdered size={14} />} note={`${fmt(data.tasks.running)} em execução · ${fmt(data.tasks.done)} concluídas`} footer="Abrir fila" onClick={() => navigate('queue')} label="Tarefas na fila">
        <div className="mt-3 flex items-center gap-2 text-[11px] text-dim"><Meter value={successRate} label="Taxa de sucesso" className="w-full" /><span className="shrink-0 tabular-nums">{successRate === null ? '—' : `${successRate}%`} sucesso</span></div>
      </StatCard>
      <StatCard title="Falhas (7 dias)" value={fmt(sum(last, 'failed'))} badge={<DeltaBadge inverse value={delta(sum(last, 'failed'), sum(previous, 'failed'))} />} note={`${fmt(data.tasks.failed)} no histórico · ${fmt(data.unread)} não lidas`} footer="Ver notificações" onClick={() => navigate('notifications')} label="Falhas nos últimos 7 dias">
        <div className="mt-3"><Sparkline values={last.map(d => d.failed)} label="Falhas por dia" width={180} /></div>
      </StatCard>
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card aria-label="Atividade">
        <CardHeader title="Atividade" description="Publicações confirmadas e vídeos importados por dia." action={<Segmented<Range> size="sm" label="Período da atividade" value={range} onChange={setRange} options={[{ value: '7', label: '7 dias' }, { value: '14', label: '14 dias' }]} />} />
        <CardBody className="grid gap-4">
          <ChartLegend series={[{ key: 'published', label: 'Publicações' }, { key: 'imported', label: 'Importações' }]} values={{ published: fmt(sum(shown, 'published')), imported: fmt(sum(shown, 'imported')) }} />
          <BarChart label="Atividade por dia" height={200} series={[{ key: 'published', label: 'Publicações' }, { key: 'imported', label: 'Importações' }]} data={shown.map(d => ({ label: dayLabel(d.day), values: { published: d.published, imported: d.imported } }))} />
        </CardBody>
      </Card>
      <Card aria-label="Falhas por dia">
        <CardHeader title="Falhas e publicações" description="Tendência diária; passe o mouse para ver os valores." icon={<AlertTriangle size={13} />} />
        <CardBody>
          <LineChart label="Falhas e publicações por dia" height={236} labels={shown.map(d => dayLabel(d.day))} series={[{ key: 'published', label: 'Publicações', values: shown.map(d => d.published) }, { key: 'failed', label: 'Falhas', values: shown.map(d => d.failed), color: 'var(--color-tone-red)' }]} />
        </CardBody>
      </Card>
    </div>

    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <Card aria-label="Origem da biblioteca">
        <CardHeader title="Origem da biblioteca" icon={<HardDrive size={13} />} action={<Button size="sm" variant="ghost" onClick={() => navigate('library')}>Abrir</Button>} />
        <CardBody className="grid place-items-center">
          {sources.length ? <DonutChart label="Vídeos por origem" centerValue={compact(data.library.count)} centerLabel="vídeos" segments={sources.slice(0, 4)} />
            : <p className="py-10 text-center text-sm text-dim">Importe vídeos para ver a distribuição por origem.</p>}
          <p className="mt-4 text-[11px] text-dim">{(data.library.bytes / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB guardados neste computador</p>
        </CardBody>
      </Card>
      <Card aria-label="Tarefas por tipo">
        <CardHeader title="Tarefas por tipo" description={successRate === null ? 'Sem tarefas finalizadas' : `${successRate}% das finalizadas concluíram`} icon={<ListOrdered size={13} />} />
        <CardBody>
          {a.jobTypes.length ? <PipelineList label="Tarefas por tipo" rows={a.jobTypes.slice(0, 5).map(t => ({ key: t.type, label: TYPES[t.type as keyof typeof TYPES] ?? t.type, detail: `${fmt(t.total)} tarefas · ${fmt(t.done)} concluídas · ${fmt(t.failed)} falhas`, value: t.total }))} />
            : <p className="py-10 text-center text-sm text-dim">Nenhuma tarefa registrada.</p>}
        </CardBody>
      </Card>
      <Card aria-label="Publicações por conta" className="lg:col-span-2 xl:col-span-1">
        <CardHeader title="Publicações por conta" description="Total confirmado no histórico." icon={<Send size={13} />} />
        <CardBody>
          {a.accounts.length ? <ul className="grid gap-3">{a.accounts.map(acc => { const top = a.accounts[0].count
            return <li key={acc.username} className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold uppercase">{acc.username.slice(0, 2)}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">@{acc.username}</p><p className="text-[11px] text-dim">Última em {new Date(acc.lastAt).toLocaleDateString('pt-BR', { timeZone: workspace.timeZone })}</p></div>
              <Meter value={acc.count / top * 100} label={`Publicações de @${acc.username}`} /><span className="w-10 text-right text-sm font-semibold tabular-nums">{fmt(acc.count)}</span></li> })}</ul>
            : <p className="py-10 text-center text-sm text-dim">Nenhuma publicação confirmada ainda.</p>}
        </CardBody>
      </Card>
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Card data-tour="profile-metrics" aria-label="Métricas dos perfis">
        <CardHeader title="Métricas dos perfis" description="Soma dos valores disponíveis nos posts carregados. Não representa o alcance total da conta. Dados ausentes aparecem como —." icon={<Users size={13} />} action={<Button size="sm" onClick={() => navigate('profiles')}>Abrir perfis</Button>} />
        {!data.profiles.length ? <CardBody><p className="text-sm text-dim">Adicione um perfil e busque reels ou importe métricas para acompanhar os resultados.</p></CardBody>
          : <div className="overflow-x-auto"><table className="ds-table"><thead><tr><th>Perfil</th><th>Baixados / posts</th><th>Visualizações</th><th>Curtidas</th><th>Comentários</th><th>Engajamento</th><th>Atualização das métricas</th></tr></thead><tbody>{data.profiles.map((p) => { const eng = engagement(p)
            return <tr key={p.id}>
              <td className="font-medium">@{p.username}</td>
              <td className="tabular-nums"><span>{p.downloaded} / {p.posts}</span><Meter className="mt-1 block" value={p.posts ? p.downloaded / p.posts * 100 : null} label={`Baixados de @${p.username}`} /></td>
              {(['views', 'likes', 'comments'] as const).map((key) => <td key={key} className="tabular-nums"><span>{fmt(p[key])}</span><span className="block text-[10px] text-dim">{p[`${key}Known`]} de {p.posts} posts</span></td>)}
              <td className="tabular-nums">{eng === null ? <span title="Indisponível">—</span> : `${eng.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`}</td>
              <td className="text-dim">{p.metricsUpdatedAt ? new Date(p.metricsUpdatedAt).toLocaleString('pt-BR', { timeZone: workspace.timeZone }) : 'Sem sincronização'}</td>
            </tr> })}</tbody></table></div>}
        {anyViews && <div className="ds-card-footer"><span>{fmt(knownViews)} visualizações conhecidas em {data.profiles.length} perfil(is)</span></div>}
      </Card>
      <Card aria-label="Posts com mais visualizações">
        <CardHeader title="Posts com mais visualizações" icon={<Film size={13} />} />
        <CardBody>
          {a.topPosts.length ? <ol className="grid gap-3">{a.topPosts.map((p, i) => <li key={p.id} className="flex items-center gap-3">
            <span className="w-4 text-xs tabular-nums text-dim">{i + 1}</span>
            {p.thumbnailPath ? <img src={mediaUrl(p.thumbnailPath)} alt="" className="h-11 w-8 shrink-0 rounded object-cover" /> : <span className="grid h-11 w-8 shrink-0 place-items-center rounded bg-raised text-dim"><Film size={14} aria-hidden /></span>}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={p.caption ?? undefined}>{p.caption || 'Sem legenda'}</p><p className="text-[11px] text-dim">@{p.username} · {compact(p.likes)} curtidas · {compact(p.comments)} comentários</p></div>
            <strong className="text-sm tabular-nums">{compact(p.views)}</strong>
          </li>)}</ol> : <p className="py-10 text-center text-sm text-dim">Sem visualizações conhecidas. Atualize as métricas de um perfil.</p>}
        </CardBody>
      </Card>
    </div>

    <Card aria-label="Atividade recente">
      <CardHeader title="Atividade recente" icon={<Upload size={13} />} action={<Button size="sm" onClick={() => navigate('queue')}>Abrir fila</Button>} />
      {!data.recent.length ? <CardBody><p className="text-sm text-dim">Nenhuma tarefa registrada.</p></CardBody> : <ul className="divide-y divide-line">{data.recent.map((j) => <li key={j.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
        <span className="min-w-0"><span className="block truncate font-medium" title={j.media ?? j.label}>{j.media ?? j.label}</span>{j.media && <span className="block truncate text-xs text-dim">{j.label}</span>}</span>
        <span className="flex shrink-0 items-center gap-3 text-xs"><span className="tabular-nums text-dim">{new Date(j.state === 'queued' ? j.runAt : j.updatedAt).toLocaleString('pt-BR', { timeZone: workspace.timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><StatusBadge tone={stateTone[j.state]}>{stateLabel[j.state]}</StatusBadge></span></li>)}</ul>}
    </Card>
  </div>
}
