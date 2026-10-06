import {
  Children,
  isValidElement,
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
  type ChangeEvent
} from 'react'
import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cx } from './cx'

export function Select({
  label,
  error,
  children,
  className,
  value,
  defaultValue,
  onChange,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  error?: string
  children: ReactNode
}) {
  const auto = useId()
  const id = props.id ?? auto
  const options = Children.toArray(children)
    .filter(
      isValidElement<{
        value?: string | number
        children?: ReactNode
        disabled?: boolean
      }>
    )
    .map((c) => ({
      value: String(c.props.value ?? c.props.children ?? ''),
      label: c.props.children,
      disabled: c.props.disabled
    }))
  const encode = (v: unknown) => String(v ?? '') || '__legacy_empty__'
  return (
    <div className="grid gap-1.5">
      <label className="text-xs text-dim" htmlFor={id}>
        {label}
      </label>
      <RadixSelect.Root
        name={props.name}
        value={value === undefined ? undefined : encode(value)}
        defaultValue={
          defaultValue === undefined ? undefined : encode(defaultValue)
        }
        disabled={props.disabled}
        required={props.required}
        onValueChange={(v) => {
          const target = {
            value: v === '__legacy_empty__' ? '' : v,
            name: props.name ?? ''
          }
          onChange?.({
            target,
            currentTarget: target
          } as ChangeEvent<HTMLSelectElement>)
        }}
      >
        <RadixSelect.Trigger
          id={id}
          aria-label={props['aria-label']}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-err` : props['aria-describedby']}
          className={cx(
            'ds-field flex h-9 w-full items-center justify-between gap-3 text-left',
            className
          )}
        >
          <RadixSelect.Value />
          <RadixSelect.Icon>
            <ChevronDown size={14} />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={6}
            className="ds-dropdown max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden"
          >
            <RadixSelect.ScrollUpButton className="grid place-items-center">
              <ChevronUp size={14} />
            </RadixSelect.ScrollUpButton>
            <RadixSelect.Viewport>
              {options.map((o) => (
                <RadixSelect.Item
                  key={o.value}
                  value={encode(o.value)}
                  disabled={o.disabled}
                  className="relative cursor-default rounded-ctl py-2 pr-8 pl-3 text-sm outline-none data-[highlighted]:bg-raised data-[disabled]:opacity-50"
                >
                  <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="absolute right-2 top-2.5">
                    <Check size={14} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
            <RadixSelect.ScrollDownButton className="grid place-items-center">
              <ChevronDown size={14} />
            </RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {error && (
        <p id={`${id}-err`} className="text-xs text-danger-fg">
          {error}
        </p>
      )}
    </div>
  )
}
