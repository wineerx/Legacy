import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ open, onOpenChange, title, description, children, footer }: {
  open: boolean; onOpenChange(open: boolean): void; title: string; description?: string; children?: ReactNode; footer?: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content {...(description ? {} : { 'aria-describedby': undefined })} className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] max-h-[85vh] overflow-auto -translate-x-1/2 -translate-y-1/2 rounded-card bg-panel border border-line p-6 shadow-2xl">
          <Dialog.Title className="pr-6 text-lg font-semibold text-fg">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1.5 text-sm text-dim">{description}</Dialog.Description>}
          <div className="mt-4">{children}</div>
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">{footer}</div>}
          <Dialog.Close className="absolute right-4 top-4 rounded-ctl p-1 text-dim hover:text-fg hover:bg-raised" aria-label="Fechar"><X size={16} /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
