import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

/** Panel with an optional header separated by a hairline, as in the shadcn dashboard references. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section {...rest} className={cx('ds-card', className)}>{children}</section>
}

export function CardHeader({ title, description, icon, action, className }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return <header className={cx('ds-card-header', className)}>
    <div className="min-w-0">
      <h2 className="ds-card-title">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-dim">{description}</p>}
    </div>
    {(action || icon) && <div className="flex shrink-0 items-center gap-2">{action}{icon && <span aria-hidden className="ds-card-icon">{icon}</span>}</div>}
  </header>
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('ds-card-body', className)}>{children}</div>
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <footer className={cx('ds-card-footer', className)}>{children}</footer>
}
