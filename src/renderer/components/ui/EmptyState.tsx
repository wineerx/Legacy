import type { ReactNode } from 'react'

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-line bg-panel px-6 py-14 text-center">
      {icon && <div className="text-dim" aria-hidden>{icon}</div>}
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <p className="max-w-sm text-sm text-dim">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
