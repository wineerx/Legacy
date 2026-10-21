import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { Tooltip } from './Tooltip'

export function Sheet({ open, onOpenChange, title, description, children, contentRef }: { open: boolean; onOpenChange(value: boolean): void; title: string; description?: string; children: ReactNode; contentRef?: Ref<HTMLDivElement> }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="queue-sheet-overlay fixed inset-0 z-40 bg-black/40" />
    {/* Focus the panel itself on open: focusing the close button showed its tooltip over the header and made the first Escape close only the tooltip. */}
    <Dialog.Content ref={contentRef} tabIndex={-1} onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).focus() }} {...(description ? {} : { 'aria-describedby': undefined })} className="outline-none queue-sheet fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] flex-col border-l border-line bg-panel shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line p-5"><div className="min-w-0"><Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>{description && <Dialog.Description className="mt-1 break-words text-xs text-dim">{description}</Dialog.Description>}</div><Tooltip content="Fechar detalhes"><Dialog.Close aria-label="Fechar detalhes" className="flex size-7 shrink-0 items-center justify-center rounded-ctl text-dim hover:bg-raised hover:text-fg"><X size={16} aria-hidden /></Dialog.Close></Tooltip></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
