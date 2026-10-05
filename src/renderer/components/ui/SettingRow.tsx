import type { ReactNode } from 'react'

export function SettingRow({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div><p className="text-sm font-semibold text-fg">{title}</p><p className="mt-0.5 text-xs text-dim">{description}</p></div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
