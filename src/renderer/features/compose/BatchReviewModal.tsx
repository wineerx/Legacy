import type { GridItem } from '@shared/types'
import { Button, Modal } from '../../components/ui'

export function BatchReviewModal({ open, onOpenChange, items, captions, reminders, timeZone, coverName, bannerOn, stripMetadata, busy, blockReason, onConfirm }: {
  open: boolean; onOpenChange(o: boolean): void; items: GridItem[]; captions: string[]; reminders: (string | null)[]; timeZone: string
  coverName: string | null; bannerOn: boolean; stripMetadata: boolean; busy: boolean; blockReason?: string; onConfirm(): void
}) {
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' })
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Revisar lote"
      description={`${items.length} vídeo(s) · capa: ${coverName ?? 'nenhuma'} · banner: ${bannerOn ? 'sim' : 'não'} · metadados opcionais: ${stripMetadata ? 'removidos' : 'mantidos'}`}
      footer={<><Button onClick={() => onOpenChange(false)}>Voltar</Button><Button variant="primary" disabledReason={blockReason ?? (busy ? 'Preparando…' : undefined)} onClick={onConfirm}>Preparar para TikTok</Button></>}>
      <ol className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={it.id} className="rounded-ctl border border-line p-2.5 text-sm">
            <p className="font-medium">{i + 1}. {it.caption}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-dim">{captions[i] || 'Sem legenda'}</p>
            <p className="mt-0.5 text-xs text-dim">{reminders[i] ? `Lembrete: ${fmt.format(new Date(reminders[i]!))}` : 'Sem lembrete (postagem manual quando quiser)'}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-dim">A postagem no TikTok é feita por você no app oficial. O Legacy prepara a pasta com vídeo, capa e legenda e avisa no horário.</p>
    </Modal>
  )
}
