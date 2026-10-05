import { cx } from './cx'

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 rounded-full border transition-colors', checked ? 'bg-fg border-fg' : 'bg-raised border-line')}>
      <span className={cx('absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all', checked ? 'left-[18px] bg-app' : 'left-0.5 bg-dim')} />
    </button>
  )
}
