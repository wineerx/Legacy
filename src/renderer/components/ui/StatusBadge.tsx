import type { ReactNode } from 'react'
import { cx } from './cx'

export type Tone = 'neutral' | 'green' | 'red' | 'orange' | 'blue' | 'purple' | 'yellow'

/** Tinted pill for states and priorities ("Ativo", "Falhou", "Alta"). Text always says the state; color only reinforces it. */
export function StatusBadge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return <span data-tone={tone} className={cx('ds-status', className)}>{dot && <i aria-hidden />}{children}</span>
}

/** Colored dot that prefixes facet options and legends. */
export function ToneDot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return <span aria-hidden data-tone={tone} className={cx('ds-dot', className)} />
}
