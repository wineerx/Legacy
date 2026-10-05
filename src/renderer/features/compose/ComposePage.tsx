import { useMemo, useState } from 'react'
import { useMascotSignal } from '../../components/brand/MascotProvider'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PenSquare } from 'lucide-react'
import type { CoverTextSpec, GridItem } from '@shared/types'
import { call, mediaUrl } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { peekComposeSelection, clearComposeSelection } from '../../lib/selection'
import { loadImage, renderCoverPng, renderBannerPng } from '../../lib/canvas'
import { Button, EmptyState, Input, Toggle, useToast } from '../../components/ui'
import type { PageProps } from '../../routes'
import { CoverEditor, DEFAULT_TEXT } from './CoverEditor'
import { BannerEditor, type BannerState } from './BannerEditor'
import { BatchReviewModal } from './BatchReviewModal'
import { SafeAreaPreview } from './SafeAreaPreview'
import { captionFor, buildReminders } from './batch'
import { CaptionRibbon } from './CaptionRibbon'

function itemError(e: unknown, k: number, n: number, caption: string): Error {
  const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'erro desconhecido'
  return new Error(`Vídeo ${k + 1} de ${n} (${caption}): ${message}`)
}

function withOverride(o: Record<string, string>, id: string, v: string): Record<string, string> {
  const next = { ...o }
  if (v === '') delete next[id]
  else next[id] = v
  return next
}

export function ComposePage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const toast = useToast()
  const [ids] = useState(() => peekComposeSelection())
  const assets = useQuery({
    queryKey: ['compose-assets', ids], enabled: ids.length > 0,
    queryFn: async () => {
      const found = new Map<string, GridItem>()
      for (let offset = 0; ; offset += 200) {
        const page = await call('grid.query', { workspaceId: workspace.id, source: 'library', sortBy: 'importedAt', sortDir: 'desc', limit: 200, offset })
        for (const i of page.items) if (ids.includes(i.id)) found.set(i.id, i)
        if (found.size >= ids.length || offset + 200 >= page.total || page.items.length === 0) break
      }
      return ids.map((id) => found.get(id)).filter((i): i is GridItem => Boolean(i))
    }
  })
  const covers = useQuery({ queryKey: ['covers', workspace.id], queryFn: () => call('covers.list', { workspaceId: workspace.id }) })
  const stripDefault = useQuery({ queryKey: ['setting', workspace.id, 'stripMetadataDefault'], queryFn: () => call('settings.get', { workspaceId: workspace.id, key: 'stripMetadataDefault' }) })
  const [coverId, setCoverId] = useState<string | null>(null)
  const [base, setBase] = useState('')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [strip, setStrip] = useState<boolean | null>(null)
  const [remind, setRemind] = useState({ enabled: false, startDate: new Date().toISOString().slice(0, 10), startTime: '18:00', intervalMin: 120 })
  const [banner, setBanner] = useState<BannerState>({ enabled: false, spec: { ...DEFAULT_TEXT, position: 'top', text: '' }, startS: 0, endS: 3 })
  const [reviewOpen, setReviewOpen] = useState(false)
  const items = assets.data ?? []
  const stripMetadata = strip ?? stripDefault.data !== 'false'
  const captions = items.map((i) => captionFor(i.id, base, overrides))
  const reminders = useMemo(() => buildReminders(items.length, { ...remind, timeZone: workspace.timeZone, now: new Date() }), [items.length, remind, workspace.timeZone])
  const cover = covers.data?.find((c) => c.id === coverId) ?? null

  const bannerActive = banner.enabled && banner.spec.text.trim() !== ''
  const blockReason = bannerActive && !(banner.startS >= 0 && banner.endS > banner.startS) ? 'O fim do banner precisa ser depois do início.' : undefined

  const run = useMutation({
    mutationFn: async () => {
      const prepared: { cover?: Uint8Array<ArrayBuffer>; banner?: Uint8Array<ArrayBuffer> }[] = []
      for (const [k, it] of items.entries()) {
        try {
          const p: { cover?: Uint8Array<ArrayBuffer>; banner?: Uint8Array<ArrayBuffer> } = {}
          if (cover) {
            const spec = cover.textJson ? (JSON.parse(cover.textJson) as CoverTextSpec) : null
            const bgPath = cover.kind === 'image' ? cover.imagePath! : (await call('library.frame', { workspaceId: workspace.id, assetId: it.id, atMs: cover.frameMs ?? 0 })).path
            p.cover = await renderCoverPng(await loadImage(mediaUrl(bgPath)), spec)
          }
          if (bannerActive) {
            const frame = await loadImage(mediaUrl((await call('library.frame', { workspaceId: workspace.id, assetId: it.id, atMs: 0 })).path))
            p.banner = await renderBannerPng(banner.spec, frame.naturalWidth, frame.naturalHeight)
          }
          prepared.push(p)
        } catch (e) { throw itemError(e, k, items.length, it.caption ?? it.id) }
      }
      for (const [k, it] of items.entries()) {
        try {
          const p = prepared[k]
          if (cover && p.cover) await call('versions.saveCover', { workspaceId: workspace.id, assetId: it.id, templateId: cover.id, png: p.cover })
          if (p.banner) await call('versions.requestBanner', { workspaceId: workspace.id, assetId: it.id, png: p.banner, startMs: Math.round(banner.startS * 1000), endMs: Math.round(banner.endS * 1000) })
        } catch (e) { throw itemError(e, k, items.length, it.caption ?? it.id) }
      }
      return call('export.tiktok', { workspaceId: workspace.id, assetIds: items.map((i) => i.id), captions: Object.fromEntries(items.map((i, k) => [i.id, captions[k]])), stripMetadata, remindAt: reminders })
    },
    onSuccess: () => { clearComposeSelection(); setReviewOpen(false); toast.show({ title: 'Lote na fila', body: 'Acompanhe em Fila. As pastas abrem pelas notificações.' }); navigate('queue') },
    onError: (e) => { setReviewOpen(false); toast.show({ title: 'Não foi possível preparar o lote', body: e instanceof Error ? e.message : undefined, tone: 'error' }) }
  })

  useMascotSignal(run.isPending, 'working', 'Preparando capas, banners e arquivos do lote.')

  if (ids.length === 0) {
    return (
      <div data-tour="compose" className="p-6">
        <h1 className="mb-4 text-lg font-semibold">Criar postagem</h1>
        <EmptyState icon={<PenSquare size={28} />} title="Escolha os vídeos do lote" body="Selecione vídeos na biblioteca e use Preparar lote." action={<Button variant="primary" onClick={() => navigate('library')}>Escolher na biblioteca</Button>} />
      </div>
    )
  }

  return (
    <div data-tour="compose" className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-lg font-semibold">Criar postagem · {items.length} vídeo(s)</h1>
        <Input label="Legenda base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="Legenda aplicada a todos os vídeos" />
        <CaptionRibbon onUse={setBase} navigate={navigate} />
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3 rounded-ctl border border-line bg-panel p-2.5">
              <div className="w-12 shrink-0 overflow-hidden rounded bg-raised" style={{ aspectRatio: '9 / 16' }}>{it.thumbnailPath && <img src={mediaUrl(it.thumbnailPath)} alt="" className="h-full w-full object-cover" />}</div>
              <div className="min-w-0 flex-1 break-words">
                <p className="text-sm">{it.caption}</p>
                <Input aria-label={`Legenda própria de ${it.caption}`} placeholder="Usar legenda base" value={overrides[it.id] ?? ''} onChange={(e) => setOverrides(withOverride(overrides, it.id, e.target.value))} />
              </div>
            </li>
          ))}
        </ul>
        <CoverEditor workspaceId={workspace.id} covers={covers.data ?? []} selectedId={coverId} onSelect={setCoverId} />
        <BannerEditor value={banner} onChange={setBanner} />
        <section className="flex flex-col gap-3 rounded-card border border-line bg-panel p-4">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Remover metadados opcionais</h2><Toggle label="Remover metadados opcionais" checked={stripMetadata} onChange={setStrip} /></div>
          <p className="text-xs text-dim">Remove localização, dispositivo e título embutidos. Mantém o que é necessário para tocar o vídeo com qualidade.</p>
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Lembretes para postar</h2><Toggle label="Lembretes para postar" checked={remind.enabled} onChange={(enabled) => setRemind({ ...remind, enabled })} /></div>
          {remind.enabled && (
            <div className="flex flex-wrap gap-2">
              <Input label="Começar em" type="date" value={remind.startDate} onChange={(e) => setRemind({ ...remind, startDate: e.target.value })} />
              <Input label="Hora" type="time" value={remind.startTime} onChange={(e) => setRemind({ ...remind, startTime: e.target.value })} />
              <Input label="Intervalo (min)" type="number" min={15} step={15} value={remind.intervalMin} onChange={(e) => setRemind({ ...remind, intervalMin: Math.max(15, Number(e.target.value)) })} />
            </div>
          )}
        </section>
      </div>
      <aside className="flex flex-col gap-4">
        <SafeAreaPreview>
          {items[0]?.thumbnailPath && <img src={mediaUrl(items[0].thumbnailPath)} alt="Prévia do primeiro vídeo" className="h-full w-full object-cover" />}
        </SafeAreaPreview>
        <Button variant="primary" disabledReason={blockReason} onClick={() => setReviewOpen(true)}>Revisar lote</Button>
      </aside>
      <BatchReviewModal open={reviewOpen} onOpenChange={setReviewOpen} items={items} captions={captions} reminders={reminders} timeZone={workspace.timeZone}
        coverName={cover?.name ?? null} bannerOn={banner.enabled} stripMetadata={stripMetadata} busy={run.isPending} blockReason={blockReason} onConfirm={() => run.mutate()} />
    </div>
  )
}
