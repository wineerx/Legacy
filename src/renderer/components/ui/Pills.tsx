import { cx } from './cx'

export function Pills<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cx('h-7 rounded-ctl px-3 text-xs font-medium transition-colors', o.value === value ? 'bg-fg text-app' : 'bg-panel text-dim border border-line hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
