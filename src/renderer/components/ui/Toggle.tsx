import { cx } from './cx'

export function Toggle({ checked, onChange, label, disabled, loading, error }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?:boolean; loading?:boolean; error?:boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled || loading} aria-busy={loading || undefined} aria-invalid={error || undefined} onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed', checked ? 'bg-fg border-fg' : 'bg-raised border-line',error && 'border-danger')}>
      <span className={cx('absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all', checked ? 'left-[18px] bg-app' : 'left-0.5 bg-dim')} />
    </button>
  )
}
