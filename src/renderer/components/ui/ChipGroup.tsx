import type { ReactNode } from 'react'
import { cx } from './cx'

type Chip<T extends string> = { value: T; label: string; icon?: ReactNode }

/** Wrapping toggle chips, single choice ("Todos", "Vídeos", "Fotos") as in the property filter reference. */
export function ChipGroup<T extends string>({ value, options, onChange, label, className }: { value: T; options: Chip<T>[]; onChange(v: T): void; label: string; className?: string }) {
  return <div role="group" aria-label={label} className={cx('flex flex-wrap gap-1.5', className)}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className="ds-chip">{o.icon}{o.label}</button>)}
  </div>
}

/** Multiple choice chips; an empty selection means "any". */
export function ChipMulti<T extends string>({ value, options, onChange, label, className }: { value: T[]; options: Chip<T>[]; onChange(v: T[]): void; label: string; className?: string }) {
  return <div role="group" aria-label={label} className={cx('flex flex-wrap gap-1.5', className)}>
    {options.map(o => { const on = value.includes(o.value)
      return <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])} className="ds-chip">{o.icon}{o.label}</button> })}
  </div>
}
