import { MoreHorizontal } from 'lucide-react'
import type { GridItem } from '@shared/types'
import { Button, Dropdown, DropdownClose } from '../../components/ui'

export function MediaActions({ item, onPreview, onCompose, onSchedule, onSave, onDelete }: { item: GridItem; onPreview(): void; onCompose(): void; onSchedule(): void; onSave(): void; onDelete(): void }) {
  return <Dropdown trigger={<button type="button" aria-label="Ações da mídia" className="rounded-ctl bg-panel p-1.5 hover:bg-raised"><MoreHorizontal size={14} /></button>}>
    <DropdownClose asChild><Button size="sm" variant="ghost" onClick={onPreview}>Visualizar e ver detalhes</Button></DropdownClose>
    <DropdownClose asChild><Button size="sm" variant="ghost" onClick={onCompose}>Criar postagem</Button></DropdownClose>
    <DropdownClose asChild><Button size="sm" variant="ghost" disabledReason={!item.postId ? 'Agendamento Instagram disponível para mídia com origem online.' : undefined} onClick={onSchedule}>Agendar no Instagram</Button></DropdownClose>
    {item.permalink && <DropdownClose asChild><Button size="sm" variant="ghost" onClick={() => window.open(item.permalink!, '_blank')}>Abrir origem</Button></DropdownClose>}
    <DropdownClose asChild><Button size="sm" variant="ghost" onClick={onSave}>Salvar cópia</Button></DropdownClose>
    <DropdownClose asChild><Button size="sm" variant="ghost" onClick={onDelete}>Excluir</Button></DropdownClose>
  </Dropdown>
}
