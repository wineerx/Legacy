import { cx } from './cx'
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-ctl bg-raised', className)} />
}
