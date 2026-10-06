import { useEffect, useState } from 'react'
import type { CoverDto } from '@shared/ipc-contract'
import type { CoverTextSpec, GridItem } from '@shared/types'
import { call, mediaUrl } from '../../lib/api'
import { loadImage, renderCoverPng, renderBannerPng } from '../../lib/canvas'
import { Pills } from '../../components/ui'
import type { BannerState } from './BannerEditor'
import { SafeAreaPreview } from './SafeAreaPreview'

// Metade da resolução de exportação (1080×1920): mesmas proporções de fonte e margens, render rápido.
const W = 540
const H = 960
const GRID_MAX = 9

type Tab = 'cover' | 'banner' | 'grid'

function useObjectUrls(render: () => Promise<(Uint8Array<ArrayBuffer> | null)[]>, deps: unknown[]): (string | null)[] {
  const [urls, setUrls] = useState<(string | null)[]>([])
  useEffect(() => {
    let alive = true
    let made: string[] = []
    const t = setTimeout(() => {
      render().then((pngs) => {
        if (!alive) return
        made = pngs.map((p) => (p ? URL.createObjectURL(new Blob([p], { type: 'image/png' })) : '')).filter(Boolean)
        let k = 0
        setUrls(pngs.map((p) => (p ? made[k++] : null)))
      }).catch(() => { if (alive) setUrls([]) })
    }, 150)
    return () => { alive = false; clearTimeout(t); made.forEach((u) => URL.revokeObjectURL(u)) }
  }, deps)
  return urls
}

async function coverBackground(workspaceId: string, cover: CoverDto, item: GridItem): Promise<HTMLImageElement> {
  const path = cover.kind === 'image' ? cover.imagePath! : (await call('library.frame', { workspaceId, assetId: item.id, atMs: cover.frameMs ?? 0 })).path
  return loadImage(mediaUrl(path))
}

/** Prévia fiel ao que é gerado: usa as mesmas funções de canvas da exportação. */
export function ComposePreview({ workspaceId, items, cover, banner }: { workspaceId: string; items: GridItem[]; cover: CoverDto | null; banner: BannerState }) {
  const bannerOn = banner.enabled && banner.spec.text.trim() !== ''
  const [tab, setTab] = useState<Tab>('cover')
  const gridItems = items.slice(0, GRID_MAX)
  const spec = cover?.textJson ? (JSON.parse(cover.textJson) as CoverTextSpec) : null
  const covers = useObjectUrls(async () => {
    if (!cover) return []
    const out: (Uint8Array<ArrayBuffer> | null)[] = []
    // Capa de imagem é igual em todos; frame com texto muda por vídeo.
    const shared = cover.kind === 'image' && gridItems[0] ? await renderCoverPng(await coverBackground(workspaceId, cover, gridItems[0]), spec, W, H) : null
    for (const it of gridItems) out.push(shared ?? await renderCoverPng(await coverBackground(workspaceId, cover, it), spec, W, H).catch(() => null))
    return out
  }, [workspaceId, cover?.id, gridItems.map((i) => i.id).join()])
  const [bannerUrl] = useObjectUrls(async () => (bannerOn ? [await renderBannerPng(banner.spec, W, H)] : []), [bannerOn, JSON.stringify(banner.spec)])

  const first = items[0]
  const thumb = (it?: GridItem) => (it?.thumbnailPath ? mediaUrl(it.thumbnailPath) : null)
  const active: Tab = tab === 'banner' && !bannerOn ? 'cover' : tab
  const caption = active === 'grid'
    ? 'Na grade do perfil o Instagram recorta a miniatura em 3:4.'
    : active === 'banner'
      ? `Banner visível de ${banner.startS}s a ${banner.endS}s.`
      : cover ? 'Na exportação manual, a capa é inserida como primeiro frame do vídeo.' : 'Sem capa: a miniatura é escolhida pela plataforma.'

  return (
    <section aria-labelledby="preview-h" className="flex flex-col gap-3 rounded-card border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="preview-h" className="text-sm font-semibold">Prévia</h2>
        <span className="text-[11px] text-dim">1080 × 1920 · 9:16</span>
      </div>
      <Pills<Tab> label="Modo da prévia" value={active} onChange={setTab}
        options={[{ value: 'cover', label: 'Capa' }, ...(bannerOn ? [{ value: 'banner' as const, label: 'Banner' }] : []), { value: 'grid', label: 'Grade' }]} />
      {active === 'grid' ? (
        <div role="img" aria-label="Prévia da grade do perfil" className="grid w-full grid-cols-3 gap-0.5 overflow-hidden rounded-ctl">
          {gridItems.map((it, i) => {
            const src = covers[i] ?? thumb(it)
            return (
              <div key={it.id} className="relative bg-raised" style={{ aspectRatio: '3 / 4' }}>
                {src && <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              </div>
            )
          })}
          {Array.from({ length: (3 - (gridItems.length % 3)) % 3 }, (_, i) => <div key={`vazio-${i}`} aria-hidden className="bg-raised/60" style={{ aspectRatio: '3 / 4' }} />)}
        </div>
      ) : (
        <SafeAreaPreview>
          {active === 'cover' && (covers[0] ?? thumb(first)) && <img src={(covers[0] ?? thumb(first))!} alt={covers[0] ? 'Prévia da capa' : 'Miniatura do primeiro vídeo'} className="h-full w-full object-cover" />}
          {active === 'banner' && <>
            {thumb(first) && <img src={thumb(first)!} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            {bannerUrl && <img src={bannerUrl} alt="Prévia do banner" className="absolute inset-0 h-full w-full object-cover" />}
          </>}
        </SafeAreaPreview>
      )}
      <p className="text-xs text-dim">{caption}</p>
    </section>
  )
}
