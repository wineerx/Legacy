import type { ReactNode } from 'react'
import { cx } from './cx'

type Option<T extends string> = { value: T; label: ReactNode; count?: number | null; icon?: ReactNode; ariaLabel?: string }

/** Tabs-like switch inside one rounded track ("Todas | Pendentes | Concluídas", "Dia | Semana"). */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md', className }: { value: T; options: Option<T>[]; onChange(v: T): void; label: string; size?: 'sm' | 'md'; className?: string }) {
  return <div role="group" aria-label={label} className={cx('ds-segmented', size === 'sm' && 'ds-segmented-sm', className)}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={o.value === value} aria-label={o.ariaLabel} onClick={() => onChange(o.value)}>
      {o.icon}{o.label}{o.count !== undefined && <span className="ds-segmented-count">{o.count ?? '—'}</span>}
    </button>)}
  </div>
}
