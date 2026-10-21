import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle, Lock } from 'lucide-react'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button } from '../../components/ui'
import type { PageProps } from '../../routes'
import { IntegrationPanel } from '../settings/IntegrationPanel'
import { DashboardWidgets } from './DashboardWidgets'
import { WelcomeCard, QuotaCard } from './OverviewCards'
import { useTutorial } from '../tutorial/TutorialProvider'
import { UpdatePanel } from '../settings/UpdatePanel'
import { LegacyMascot } from '../../components/brand/LegacyMascot'
import { useMascot } from '../../components/brand/MascotProvider'

export function OverviewPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const tutorial = useTutorial()
  const mascot = useMascot()
  const dashboard = useQuery({ queryKey: ['dashboard', workspace.id], queryFn: () => call('dashboard.get', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const steps = useQuery({ queryKey: ['onboarding', workspace.id], queryFn: () => call('onboarding.status', { workspaceId: workspace.id }) })
  const list = steps.data ?? []
  const done = list.filter((s) => s.done).length
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1><p className="text-sm text-dim">{workspace.name}</p></div><div className="flex gap-2"><Button onClick={() => tutorial.start('app')}>Tour do Legacy</Button><Button onClick={() => navigate('tutorial')}>Guias e legendas</Button></div></header>
      {dashboard.data ? <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"><WelcomeCard data={dashboard.data} status={mascot.message} mascotState={mascot.state} navigate={navigate} /><QuotaCard data={dashboard.data} navigate={navigate} /></div> : <p role="status" className="text-sm text-dim">Carregando visão geral…</p>}
      <DashboardWidgets navigate={navigate} />
      <IntegrationPanel />
      <section aria-label="Primeiros passos" className="ds-card">
        <div className="ds-card-header"><div><h2 className="ds-card-title">Primeiros passos</h2><p className="mt-0.5 text-xs text-dim">Conclua estes passos para aproveitar o Legacy.</p></div><span className="text-xs text-dim">{done} de {list.length} concluídos</span></div>
        <div className="flex gap-1.5 px-4 pt-4" aria-hidden>{list.map((s) => <span key={s.key} className={s.done ? 'h-1 flex-1 rounded-full bg-fg' : 'h-1 flex-1 rounded-full bg-raised'} />)}</div>
        <ol className="flex flex-col divide-y divide-line px-4 pb-1 pt-2">
          {list.map((s) => (
            <li key={s.key} className="flex items-start gap-3 py-3">
              {s.done ? <CheckCircle2 size={18} className="text-ok" aria-label="Concluído" /> : s.disabledReason ? <Lock size={18} className="text-mute" aria-label="Indisponível" /> : <Circle size={18} className="text-dim" aria-label="Pendente" />}
              <div className="min-w-0 flex-1"><p className={s.done ? 'text-sm text-dim' : 'text-sm font-medium'}>{s.label}</p>{s.disabledReason && <p className="text-xs text-dim">{s.disabledReason}</p>}</div>
              <span className="text-xs text-dim">{s.done ? 'Feito' : s.disabledReason ? 'Indisponível' : 'Pendente'}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => navigate('library')}>Abrir biblioteca</Button>
        <Button onClick={() => navigate('profiles')}>Acompanhar um perfil</Button>
      </div>
      <UpdatePanel />
    </div>
  )
}
