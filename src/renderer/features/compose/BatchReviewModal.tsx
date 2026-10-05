import type { GridItem } from '@shared/types'
import { Button, Modal } from '../../components/ui'
import { useMascotSignal } from '../../components/brand/MascotProvider'
import { LegacyMascot } from '../../components/brand/LegacyMascot'
import { zonedToUtc } from '@shared/schedule'

export function BatchReviewModal({ open, onOpenChange, items, captions, reminders, timeZone, coverName, bannerOn, stripMetadata, busy, blockReason, instagram, delivery, intervalMin=60, tiktok=true, onConfirm }: {
  open: boolean; onOpenChange(o: boolean): void; items: GridItem[]; captions: string[]; reminders: (string | null)[]; timeZone: string
  coverName: string | null; bannerOn: boolean; stripMetadata: boolean; busy: boolean; blockReason?: string; onConfirm(): void
  instagram?: string; delivery?: string; intervalMin?: number; tiktok?: boolean
}) {
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' })
  useMascotSignal(open && !busy, 'approval', 'O lote aguarda sua revisão de destinos e horários.')
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Revisar lote"
      description={`${items.length} vídeo(s) · capa: ${coverName ?? 'nenhuma'} · banner: ${bannerOn ? 'sim' : 'não'}${tiktok ? ` · metadados opcionais na exportação: ${stripMetadata ? 'removidos' : 'mantidos'}` : ' · Instagram usa o original online'}`}
      footer={<><Button disabled={busy} onClick={() => onOpenChange(false)}>Voltar</Button><Button variant="primary" loading={busy} disabledReason={blockReason} onClick={onConfirm}>{instagram ? 'Confirmar destinos' : 'Preparar para TikTok'}</Button></>}>
      {instagram && <div className="ds-summary mb-3"><strong>Instagram — @{instagram}</strong><p className="mt-1 text-xs">Primeira publicação: {delivery?.replace('T',' às ')} · {timeZone}. O PC precisa estar ligado e o Legacy aberto. A API confirma cada publicação na Fila.</p></div>}
      <div className="mb-3 flex items-center gap-2"><LegacyMascot state={busy ? 'working' : 'approval'} size={48} decorative /><p className="text-sm text-dim">Confira o lote antes de continuar.</p></div>
      <ol className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={it.id} className="rounded-ctl border border-line p-2.5 text-sm">
            <p className="font-medium">{i + 1}. {it.caption}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-dim">{captions[i] || 'Sem legenda'}</p>
            {instagram && delivery && <p className="mt-0.5 text-xs text-dim">Instagram: {fmt.format(new Date(zonedToUtc(delivery.split('T')[0],delivery.split('T')[1],timeZone).getTime()+i*intervalMin*60000))}</p>}
            {tiktok && <p className="mt-0.5 text-xs text-dim">{reminders[i] ? `Lembrete TikTok: ${fmt.format(new Date(reminders[i]!))}` : 'TikTok: postagem manual quando quiser'}</p>}
          </li>
        ))}
      </ol>
      {tiktok && <p className="mt-3 text-xs text-dim">A postagem no TikTok é feita por você no app oficial. O Legacy prepara a pasta com vídeo, capa e legenda e avisa no horário.</p>}
    </Modal>
  )
}
