import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ChevronDown } from 'lucide-react'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import type { PageKey } from '../../routes'
import { cx } from '../../components/ui'
const targets: Record<string, PageKey> = { connect_instagram: 'accounts', profile: 'profiles', import_videos: 'library', first_batch: 'compose', schedule: 'profiles' }
export function FirstSteps({ navigate }: { navigate(page: PageKey): void }) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const steps = useQuery({ queryKey: ['onboarding', workspace.id], queryFn: () => call('onboarding.status', { workspaceId: workspace.id }) })
  const dismissed = useQuery({ queryKey: ['setting', workspace.id, 'onboardingDismissed'], queryFn: () => call('settings.get', { workspaceId: workspace.id, key: 'onboardingDismissed' }) })
  const dismiss = useMutation({ mutationFn: (value: boolean) => call('settings.set', { workspaceId: workspace.id, key: 'onboardingDismissed', value: value ? 'true' : 'false' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['setting', workspace.id, 'onboardingDismissed'] }) })
  const items = steps.data ?? []
  const done = items.filter(s => s.done).length
  if (dismissed.data === 'true' && items.length && done === items.length) return <button className="mb-2 text-xs text-dim" onClick={() => dismiss.mutate(false)}>Mostrar primeiros passos</button>
  return <section aria-label="Primeiros passos" className="mb-2 rounded-card border border-line bg-panel p-3 text-[11px]">
    <div className="flex justify-between gap-2"><h2 className="font-semibold">Primeiros passos</h2><span className="text-dim">{done} de {items.length || 5}</span></div>
    <progress aria-label="Progresso dos primeiros passos" value={done} max={items.length || 5} className="legacy-first-progress my-2 h-1 w-full" />
    {steps.isLoading ? <p role="status">Carregando…</p> : steps.isError ? <button onClick={() => void steps.refetch()}>Tentar carregar novamente</button> : <ul className="flex flex-col gap-1">{items.map(step => <li key={step.key}><button onClick={() => navigate(targets[step.key] ?? 'overview')} className={cx('-ml-2 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-ctl py-1 pl-2 text-left hover:bg-raised', step.done && 'text-dim')}><span>{step.done ? <CheckCircle2 size={12} aria-label="Concluído" /> : <Circle size={12} aria-label="Pendente" />}</span><span className={step.done ? 'line-through' : ''}>{step.label}</span></button></li>)}</ul>}
    {items.length > 0 && done === items.length && <button onClick={() => dismiss.mutate(true)} className="mt-2 flex items-center gap-1 text-dim"><ChevronDown size={12} />Recolher checklist</button>}
  </section>
}
