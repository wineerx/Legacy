import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { DayPicker } from 'react-day-picker'
import { ptBR } from 'react-day-picker/locale'
import { CalendarDays } from 'lucide-react'
import { Button } from './Button'
import 'react-day-picker/style.css'

export function DatePicker({
  label,
  value,
  onChange,
  min,
  clearable = false
}: {
  label: string
  value: string
  onChange(value: string): void
  min?: string
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const date = value ? new Date(`${value}T12:00:00`) : undefined
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-dim">{label}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className="ds-field flex h-9 w-full items-center justify-between gap-3 text-left"
          aria-label={label}
        >
          <span>
            {value ? value.split('-').reverse().join('/') : 'Selecionar data'}
          </span>
          <CalendarDays size={16} className="text-dim" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="ds-dropdown date-picker"
            align="start"
            sideOffset={6}
          >
            <DayPicker
              mode="single"
              locale={ptBR}
              selected={date}
              defaultMonth={date}
              formatters={{
                formatCaption: (d) =>
                  d.toLocaleDateString('pt-BR', {
                    month: 'long',
                    year: 'numeric'
                  })
              }}
              disabled={
                min ? { before: new Date(`${min}T00:00:00`) } : undefined
              }
              onSelect={(d) => {
                if (!d) return
                onChange(
                  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                )
                setOpen(false)
              }}
            />
            {clearable && value && (
              <Button
                size="sm"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                Limpar data
              </Button>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
