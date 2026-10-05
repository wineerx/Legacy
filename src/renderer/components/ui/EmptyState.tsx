import type { ReactNode } from 'react'
import { LegacyMascot, type MascotState } from '../brand/LegacyMascot'

export function EmptyState({ icon, title, body, action, mascotState = 'idle' }: { icon: ReactNode; title: string; body: string; action?: ReactNode; mascotState?: MascotState }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-line bg-panel px-6 py-14 text-center">
      <div className="relative"><LegacyMascot state={mascotState} size={88} decorative animated={false} />{icon && <div className="absolute -right-1 bottom-0 rounded-full bg-panel p-1 text-dim" aria-hidden>{icon}</div>}</div>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <p className="max-w-sm text-sm text-dim">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
