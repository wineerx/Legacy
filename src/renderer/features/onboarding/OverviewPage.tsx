import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle, Lock } from 'lucide-react'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button } from '../../components/ui'
import type { PageProps } from '../../routes'
import { IntegrationPanel } from '../settings/IntegrationPanel'
import { DashboardWidgets } from './DashboardWidgets'
import { useTutorial } from '../tutorial/TutorialProvider'
import { UpdatePanel } from '../settings/UpdatePanel'

export function OverviewPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const tutorial = useTutorial()
  const steps = useQuery({ queryKey: ['onboarding', workspace.id], queryFn: () => call('onboarding.status', { workspaceId: workspace.id }) })
  const list = steps.data ?? []
  const done = list.filter((s) => s.done).length
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Visão geral</h1><p className="text-sm text-dim">{workspace.name}</p></div><div className="flex gap-2"><Button onClick={() => tutorial.start('app')}>Tour do Legacy</Button><Button onClick={() => navigate('tutorial')}>Guias e legendas</Button></div></header>
      <DashboardWidgets navigate={navigate} />
      <IntegrationPanel />
      <section className="rounded-card border border-line bg-panel p-6">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Primeiros passos</h2><span className="text-xs text-dim">{done} de {list.length} concluídos</span></div>
        <ol className="mt-4 flex flex-col gap-3">
          {list.map((s) => (
            <li key={s.key} className="flex items-start gap-3">
              {s.done ? <CheckCircle2 size={18} className="text-ok" aria-label="Concluído" /> : s.disabledReason ? <Lock size={18} className="text-mute" aria-label="Indisponível" /> : <Circle size={18} className="text-dim" aria-label="Pendente" />}
              <div><p className="text-sm">{s.label}</p>{s.disabledReason && <p className="text-xs text-dim">{s.disabledReason}</p>}</div>
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
