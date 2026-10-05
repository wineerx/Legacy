import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'
import { Spinner } from './Fields'

const variants = {
  primary: 'bg-fg text-app hover:bg-white',
  secondary: 'bg-panel text-fg border border-line hover:bg-raised',
  ghost: 'text-dim hover:text-fg hover:bg-raised',
  danger: 'bg-danger text-white hover:brightness-110'
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: 'sm' | 'md'; icon?: ReactNode; disabledReason?: string; loading?: boolean }

export function Button({ variant = 'secondary', size = 'md', icon, disabledReason, loading, className, onClick, children, ...rest }: Props) {
  const reasonId = useId()
  const blocked = Boolean(disabledReason)
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        {...rest}
        disabled={rest.disabled || loading}
        aria-busy={loading || undefined}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : rest['aria-describedby']}
        onClick={(e) => { if (blocked) { e.preventDefault(); return } onClick?.(e) }}
        className={cx(
          'ds-button inline-flex items-center justify-center gap-2 rounded-ctl font-medium transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed',
          size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
          variants[variant], blocked && 'opacity-50 cursor-not-allowed', className
        )}
      >
        {loading ? <Spinner /> : icon}
        {children}
      </button>
      {blocked && <span id={reasonId} role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-1 w-max max-w-64 whitespace-normal rounded-ctl border border-line bg-raised px-2 py-1 text-xs text-fg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">{disabledReason}</span>}
    </span>
  )
}
