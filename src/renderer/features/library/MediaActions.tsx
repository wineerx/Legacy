import * as Popover from '@radix-ui/react-popover'
import { MoreHorizontal } from 'lucide-react'
import type { GridItem } from '@shared/types'
import { Button } from '../../components/ui'
export function MediaActions({ item, onPreview, onCompose, onSchedule, onSave, onDelete }: { item: GridItem; onPreview(): void; onCompose(): void; onSchedule(): void; onSave(): void; onDelete(): void }) {
  return <Popover.Root><Popover.Trigger asChild><button type="button" aria-label="Ações da mídia" className="rounded-ctl bg-panel p-1.5 hover:bg-raised"><MoreHorizontal size={14} /></button></Popover.Trigger><Popover.Portal><Popover.Content align="end" sideOffset={6} className="z-30 flex w-52 flex-col gap-1 rounded-card border border-line bg-panel p-2 shadow-lg">
    <Popover.Close asChild><Button size="sm" variant="ghost" onClick={onPreview}>Visualizar e ver detalhes</Button></Popover.Close>
    <Popover.Close asChild><Button size="sm" variant="ghost" onClick={onCompose}>Criar postagem</Button></Popover.Close>
    <Popover.Close asChild><Button size="sm" variant="ghost" disabledReason={!item.postId ? 'Agendamento Instagram disponível para mídia com origem online.' : undefined} onClick={onSchedule}>Agendar no Instagram</Button></Popover.Close>
    {item.permalink && <Popover.Close asChild><Button size="sm" variant="ghost" onClick={() => window.open(item.permalink!, '_blank')}>Abrir origem</Button></Popover.Close>}
    <Popover.Close asChild><Button size="sm" variant="ghost" onClick={onSave}>Salvar cópia</Button></Popover.Close>
    <Popover.Close asChild><Button size="sm" variant="ghost" onClick={onDelete}>Excluir</Button></Popover.Close>
  </Popover.Content></Popover.Portal></Popover.Root>
}
