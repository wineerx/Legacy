import { useId, type InputHTMLAttributes } from 'react'
import { NumberField } from './NumberField'
import { cx } from './cx'

export function Input({ label, error, className, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  const auto = useId()
  const inputId = id ?? auto
  const Field = rest.type === 'number' ? NumberField : 'input'
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-xs text-dim">{label}</label>}
      <Field
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cx('ds-field h-9', error && 'border-danger', className)}
        {...rest}
        aria-label={rest['aria-label'] ?? label}
        aria-describedby={[error && `${inputId}-err`, rest['aria-describedby']].filter(Boolean).join(' ') || undefined}
      />
      {error && <p id={`${inputId}-err`} className="text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
