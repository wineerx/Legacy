import { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ChevronRight, X } from 'lucide-react'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import type { PageKey } from '../../routes'
import { cx } from '../../components/ui'

const targets: Record<string, PageKey> = { connect_instagram: 'accounts', profile: 'profiles', import_videos: 'library', first_batch: 'compose', schedule: 'profiles' }

export function FirstSteps({ navigate, collapsed = false }: { navigate(page: PageKey): void; collapsed?: boolean }) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const [closedWorkspace, setClosedWorkspace] = useState<string | null>(null)
  useEffect(() => {
    if (collapsed) setClosedWorkspace(workspace.id)
  }, [collapsed, workspace.id])
  const settingKey = ['setting', workspace.id, 'onboardingDismissed']
  const steps = useQuery({ queryKey: ['onboarding', workspace.id], queryFn: () => call('onboarding.status', { workspaceId: workspace.id }) })
  const dismissed = useQuery({ queryKey: settingKey, queryFn: () => call('settings.get', { workspaceId: workspace.id, key: 'onboardingDismissed' }) })
  const dismiss = useMutation({
    mutationFn: (value: boolean) => call('settings.set', { workspaceId: workspace.id, key: 'onboardingDismissed', value: value ? 'true' : 'false' }),
    onSuccess: (_, value) => { qc.setQueryData(settingKey, value ? 'true' : 'false'); setClosedWorkspace(null) }
  })
  const items = steps.data ?? []
  const done = items.filter(s => s.done).length
  const total = items.length || 5
  const next = items.find(s => !s.done)?.key
  const open = !collapsed && !dismissed.isLoading && dismissed.data !== 'true' && closedWorkspace !== workspace.id

  const show = () => { if (dismissed.data === 'true') dismiss.mutate(false); else setClosedWorkspace(null) }
  if (collapsed) return null
  return <div className="first-steps mb-2 shrink-0">
    <Popover.Root open={open} onOpenChange={value => { if (value) show(); else setClosedWorkspace(workspace.id) }}>
      <Popover.Trigger asChild><button type="button" aria-label="Mostrar primeiros passos" disabled={dismiss.isPending || dismissed.isLoading} className="first-steps-show disabled:opacity-50">
        <svg aria-hidden="true" className="first-steps-summary-ring" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
          <circle className="first-steps-ring" cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - done / total * 100} />
        </svg>
        <span className="first-steps-summary-title">Primeiros passos</span>
        <span className="first-steps-summary-count">{done} de {total}</span>
      </button></Popover.Trigger>
      <Popover.Portal><Popover.Content side="top" align="center" sideOffset={12} collisionPadding={8} onOpenAutoFocus={event => event.preventDefault()} aria-label="Primeiros passos" className="first-steps-card border border-line bg-panel text-[13px]">
          <header className="mb-4 flex items-center gap-2">
            <svg role="progressbar" aria-label="Progresso dos primeiros passos" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} className="size-10 shrink-0 -rotate-90" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="18" fill="none" stroke="var(--color-raised)" strokeWidth="4" />
              <circle className="first-steps-ring" cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - done / total * 100} />
            </svg>
            <div className="min-w-0 flex-1"><h2 className="font-semibold leading-5">Primeiros passos</h2><p className="text-xs text-dim">{done} de {total} concluídos</p></div>
            <button type="button" aria-label="Fechar primeiros passos" onClick={() => setClosedWorkspace(workspace.id)} className="first-steps-close flex size-6 shrink-0 items-center justify-center rounded-ctl hover:bg-raised"><X size={16} aria-hidden /></button>
          </header>
          {steps.isLoading ? <p role="status" className="py-3 text-dim">Carregando…</p> : steps.isError ? <button type="button" onClick={() => void steps.refetch()} className="py-3 text-dim">Tentar carregar novamente</button> : <ul className="flex flex-col gap-0.5">
            {items.map(step => <li key={step.key}><button type="button" onClick={() => navigate(targets[step.key] ?? 'overview')} data-next={step.key === next || undefined} className={cx('first-steps-task flex min-h-7 w-full items-center gap-2 rounded-[10px] px-2 py-1 text-left', step.done ? 'text-dim' : step.key === next ? 'bg-raised font-semibold' : 'text-dim')}>
              {step.done ? <CheckCircle2 size={15} className="shrink-0" aria-label="Concluído" /> : <Circle size={15} className="shrink-0" aria-label="Pendente" />}
              <span className={cx('min-w-0 flex-1 text-xs leading-5', step.done && 'line-through')}>{step.label}</span>
              {step.key === next && <ChevronRight size={14} className="shrink-0 text-dim" aria-hidden />}
            </button></li>)}
          </ul>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    {!open && dismiss.isError && <p role="alert" className="text-xs text-danger-icon">Não foi possível reabrir. Tente novamente.</p>}
  </div>
}
