import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

const variants = {
  primary: 'bg-fg text-app hover:bg-white',
  secondary: 'bg-panel text-fg border border-line hover:bg-raised',
  ghost: 'text-dim hover:text-fg hover:bg-raised',
  danger: 'bg-danger text-white hover:brightness-110'
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: 'sm' | 'md'; icon?: ReactNode; disabledReason?: string }

export function Button({ variant = 'secondary', size = 'md', icon, disabledReason, className, onClick, children, ...rest }: Props) {
  const reasonId = useId()
  const blocked = Boolean(disabledReason)
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        {...rest}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : rest['aria-describedby']}
        onClick={(e) => { if (blocked) { e.preventDefault(); return } onClick?.(e) }}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-ctl font-medium transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed',
          size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
          variants[variant], blocked && 'opacity-50 cursor-not-allowed', className
        )}
      >
        {icon}
        {children}
      </button>
      {blocked && <span id={reasonId} role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-ctl border border-line bg-raised px-2 py-1 text-xs text-fg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">{disabledReason}</span>}
    </span>
  )
}
