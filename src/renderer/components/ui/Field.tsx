import type { ComponentProps } from 'react'
import { cx } from './cx'

// shadcn Field composition, adapted to the existing Legacy tokens and labeled controls.
export function FieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cx('flex w-full flex-col gap-4', className)} {...props} />
}
export function Field({ className, ...props }: ComponentProps<'div'>) {
  return <div role="group" data-slot="field" className={cx('flex w-full flex-col gap-1.5 data-[invalid=true]:text-danger-fg', className)} {...props} />
}
export function FieldDescription(props: ComponentProps<'p'>) {
  return <p data-slot="field-description" className="text-xs text-dim" {...props} />
}
export function FieldError(props: ComponentProps<'div'>) {
  return <div role="alert" data-slot="field-error" className="text-xs text-danger-fg" {...props} />
}
