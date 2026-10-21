import { useEffect, useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { Clock3 } from 'lucide-react'

export function TimePicker({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const hours = useRef<HTMLDivElement>(null)
  const minutes = useRef<HTMLDivElement>(null)
  const [hour = '', minute = ''] = value.split(':')
  useEffect(() => {
    if (!open) return
    for (const column of [hours.current, minutes.current]) {
      const selected = column?.querySelector<HTMLButtonElement>('[data-state="on"]')
      if (column && selected) column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.offsetHeight / 2
    }
  }, [open, hour, minute])
  const column = (part: 'hour' | 'minute') => {
    const isHour = part === 'hour'
    return <div className="min-w-0">
      <p className="mb-2 text-center text-xs text-dim">{isHour ? 'Horas' : 'Minutos'}</p>
      <ToggleGroup.Root ref={isHour ? hours : minutes} type="single" orientation="vertical" value={isHour ? hour : minute} aria-label={isHour ? 'Horas' : 'Minutos'} className="time-picker-column" onValueChange={number => {
        if (number) onChange(isHour ? `${number}:${minute || '00'}` : `${hour || '00'}:${number}`)
      }}>
        {Array.from({ length: isHour ? 24 : 60 }, (_, i) => String(i).padStart(2, '0')).map(number => <ToggleGroup.Item key={number} value={number} aria-label={`${isHour ? 'Hora' : 'Minuto'} ${number}`} className="time-picker-option">{number}</ToggleGroup.Item>)}
      </ToggleGroup.Root>
    </div>
  }
  return <div className="grid gap-1.5">
    <label htmlFor={id} className="text-xs text-dim">{label}</label>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild><div className="ds-field flex h-9 w-full items-center gap-3">
        <input id={id} type="time" value={value} onChange={event => onChange(event.target.value)} className="time-picker-input min-w-0 flex-1 bg-transparent outline-none" />
        <Popover.Trigger type="button" aria-label={`Selecionar horário: ${label}`} className="flex size-6 shrink-0 items-center justify-center rounded-ctl text-dim hover:bg-raised hover:text-fg"><Clock3 size={16} aria-hidden /></Popover.Trigger>
      </div></Popover.Anchor>
      <Popover.Portal><Popover.Content className="ds-dropdown time-picker" aria-label={`Seletor de horário: ${label}`} align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={event => {
        event.preventDefault()
        const first = hours.current?.querySelector<HTMLButtonElement>('[data-state="on"]') ?? hours.current?.querySelector<HTMLButtonElement>('button')
        first?.focus({ preventScroll: true })
        requestAnimationFrame(() => {
          for (const column of [hours.current, minutes.current]) {
            const selected = column?.querySelector<HTMLButtonElement>('[data-state="on"]')
            if (column && selected) column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.offsetHeight / 2
          }
        })
      }}>
        <div className="mb-3 flex items-center justify-between px-1 text-[13px] font-semibold"><span>Horário</span><span className="text-dim">{value || '—:—'}</span></div>
        <div className="grid grid-cols-2 gap-3">{column('hour')}{column('minute')}</div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>
}
