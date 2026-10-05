import { useId, type InputHTMLAttributes } from 'react'
import { cx } from './cx'

export function Input({ label, error, className, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-xs text-dim">{label}</label>}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cx('h-9 rounded-ctl bg-panel border px-3 text-sm text-fg placeholder:text-mute focus:border-line-strong outline-none', error ? 'border-danger' : 'border-line', className)}
        {...rest}
        aria-describedby={[error && `${inputId}-err`, rest['aria-describedby']].filter(Boolean).join(' ') || undefined}
      />
      {error && <p id={`${inputId}-err`} className="text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
