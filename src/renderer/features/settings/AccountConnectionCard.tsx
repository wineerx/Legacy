import type { ReactNode } from 'react'
import { ArrowRight, Link2 } from 'lucide-react'
import { Badge, Button } from '../../components/ui'

type Props = {
  name: string
  icon: ReactNode
  description: string
  status: string
  connected?: boolean
  action: string
  onAction?: () => void
  onDetails?: () => void
}

export function AccountConnectionCard({ name, icon, description, status, connected, action, onAction, onDetails }: Props) {
  return <article aria-label={name} className="flex min-w-0 flex-col gap-4 rounded-card border border-line/60 bg-panel p-5">
    <div className="flex items-center justify-between gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl bg-raised" aria-hidden="true">{icon}</span>
      <Badge tone={connected ? 'success' : undefined}>{status}</Badge>
    </div>
    <div className="flex-1">
      <h3 className="font-semibold">{name}</h3>
      <p className="mt-2 text-sm leading-relaxed text-dim">{description}</p>
    </div>
    <div className="flex flex-col gap-2 [&>span]:w-full">
      <Button className="w-full" size="sm" icon={onAction ? <Link2 size={14}/> : undefined} disabled={!onAction} onClick={onAction}>{action}</Button>
      {onDetails && <Button className="w-full" size="sm" variant="ghost" onClick={onDetails}>Ver opções <ArrowRight size={14}/></Button>}
    </div>
  </article>
}
