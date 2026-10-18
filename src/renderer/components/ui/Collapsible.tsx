import { createContext, forwardRef, useContext, useId, useState, type ComponentProps, type ReactNode } from 'react'
import * as Primitive from '@radix-ui/react-collapsible'
import { ChevronRight } from 'lucide-react'
import { cx } from './cx'

const OpenContext = createContext(false)

export const Collapsible = forwardRef<HTMLDivElement, ComponentProps<typeof Primitive.Root>>(
  function Collapsible({ open: controlledOpen, defaultOpen = false, onOpenChange, className, ...props }, ref) {
    const [localOpen, setLocalOpen] = useState(defaultOpen)
    const open = controlledOpen ?? localOpen
    return <OpenContext.Provider value={open}>
      <Primitive.Root {...props} ref={ref} open={open} onOpenChange={value => {
        if (controlledOpen === undefined) setLocalOpen(value)
        onOpenChange?.(value)
      }} className={cx('collapsible', className)} />
    </OpenContext.Provider>
  }
)

export const CollapsibleTrigger = forwardRef<HTMLButtonElement, ComponentProps<typeof Primitive.Trigger>>(
  function CollapsibleTrigger({ className, ...props }, ref) {
    return <Primitive.Trigger {...props} ref={ref} className={cx('collapsible-trigger', className)} />
  }
)

type ContentProps = Omit<ComponentProps<typeof Primitive.Content>, 'asChild' | 'forceMount'> & {
  bodyClassName?: string
}

export const CollapsibleContent = forwardRef<HTMLDivElement, ContentProps>(
  function CollapsibleContent({ className, bodyClassName, children, ...props }, ref) {
    const open = useContext(OpenContext)
    // Keep form values mounted and animate an inner grid: Radix temporarily disables
    // transitions on its own node while measuring. The grid also handles dynamic
    // content heights and reverses smoothly when the trigger is clicked rapidly.
    return <Primitive.Content {...props} ref={ref} forceMount inert={!open} aria-hidden={!open}
      className={cx('collapsible-content', className)}>
      <div className="collapsible-height" data-state={open ? 'open' : 'closed'}>
        <div className="collapsible-clip">
          <div className={cx('collapsible-body', bodyClassName)}>{children}</div>
        </div>
      </div>
    </Primitive.Content>
  }
)

type CardProps = Omit<ComponentProps<typeof Collapsible>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  contentClassName?: string
}

/** Actions sit beside the full-width trigger, never inside its button. */
export function CollapsibleCard({ title, description, actions, children, contentClassName, ...props }: CardProps) {
  const titleId = useId()
  const descriptionId = useId()
  return <Collapsible {...props}>
    <div className="collapsible-header">
      <CollapsibleTrigger aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
        <span className="collapsible-heading">
          <span id={titleId} className="collapsible-title">{title}</span>
          {description && <span id={descriptionId} className="collapsible-description">{description}</span>}
        </span>
        <ChevronRight aria-hidden="true" className="collapsible-chevron" />
      </CollapsibleTrigger>
      {actions && <div className="collapsible-actions">{actions}</div>}
    </div>
    <CollapsibleContent bodyClassName={contentClassName}>{children}</CollapsibleContent>
  </Collapsible>
}
