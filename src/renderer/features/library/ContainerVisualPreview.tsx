import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pngDimensions, watermarkGeometry, type ContainerVisualSnapshot } from '@shared/container-visual'
import type { GridItem } from '@shared/types'
import { call, mediaUrl } from '../../lib/api'
import { FieldError } from '../../components/ui/Field'
import { VisualPreview } from '../templates/VisualPreview'

const imageUrl = (value: string) => value.startsWith('data:image/png;base64,') ? value : mediaUrl(value)
export function ContainerVisualPreview({ media, snapshot, workspaceId, recipeVersionId }: { media: GridItem; snapshot: ContainerVisualSnapshot; workspaceId: string; recipeVersionId?: string }) {
  const [size, setSize] = useState({ width: 360, height: 640 })
  const [timeMs, setTimeMs] = useState(0)
  const [failed, setFailed] = useState(false)
  const overrides = useQuery({ queryKey: ['container-visual-overrides', workspaceId, media.id, recipeVersionId], enabled: Boolean(recipeVersionId), queryFn: () => call('containers.previewOverrides', { workspaceId, assetId: media.kind === 'asset' ? media.id : media.assetId!, recipeVersionId }) })
  const override = overrides.data
  const cover = override?.coverPath ?? (snapshot.cover?.enabled ? snapshot.cover.imageData : null)
  const showingCover = Boolean(cover && !override?.sourcePath && timeMs < 33)
  const banner = override?.banner ?? (snapshot.banner?.enabled && snapshot.banner.imageData && !override?.sourcePath ? { path: snapshot.banner.imageData, startMs: snapshot.banner.startMs, endMs: snapshot.banner.endMs, firstFrame: false } : null)
  const watermark = override?.watermark ?? snapshot.watermark
  const geometry = watermark?.enabled && watermark.imageData ? watermarkGeometry(size.width, size.height, pngDimensions(watermark.imageData), watermark) : null
  const path = override?.sourcePath ?? media.filePath
  if(snapshot.version===2)return <><VisualPreview value={snapshot} media={media} overrides={override} disabled />{overrides.isError && <FieldError>Não foi possível carregar configuração individual.</FieldError>}</>
  return <div className="flex flex-col gap-2">
    {overrides.isError && <FieldError>Não foi possível carregar a configuração individual deste vídeo.</FieldError>}
    <div data-testid="container-visual-preview" className="relative mx-auto w-full max-w-64 overflow-hidden rounded-ctl" style={{ aspectRatio: `${size.width}/${size.height}` }}>
      {path && !failed ? <video key={path} aria-label="Prévia do rascunho" controls playsInline preload="metadata" src={mediaUrl(path)} poster={media.thumbnailPath ? mediaUrl(media.thumbnailPath) : undefined}
        onLoadedMetadata={e => { if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight }) }} onTimeUpdate={e => setTimeMs(e.currentTarget.currentTime * 1000)} onSeeked={e => setTimeMs(e.currentTarget.currentTime * 1000)} onError={() => setFailed(true)} className="block size-full object-contain" /> : <p role="status" className="p-4 text-xs text-dim">Arquivo indisponível para reprodução.</p>}
      {!overrides.isLoading && !overrides.isError && showingCover && <img data-testid="visual-cover" src={imageUrl(cover!)} alt="Prévia da capa" className="pointer-events-none absolute inset-0 size-full object-cover" />}
      {!overrides.isLoading && !overrides.isError && banner && !showingCover && (banner.firstFrame && timeMs === 0 || timeMs >= banner.startMs && timeMs <= banner.endMs) && <img data-testid="visual-banner" src={imageUrl(banner.path)} alt="Prévia do banner" className="pointer-events-none absolute inset-0 size-full" />}
      {!overrides.isLoading && !overrides.isError && geometry && watermark?.imageData && <img data-testid="visual-watermark" src={watermark.imageData} alt="Prévia da marca d’água" className="pointer-events-none absolute" style={{ left: `${geometry.x / size.width * 100}%`, top: `${geometry.y / size.height * 100}%`, width: `${geometry.width / size.width * 100}%`, height: `${geometry.height / size.height * 100}%`, opacity: watermark.opacityPct / 100 }} />}
    </div>
    <p className="text-xs text-dim">Prévia local da composição. Capa no primeiro quadro; a marca d’água também aparece sobre a capa. Cor e compressão podem variar na publicação.</p>
    {recipeVersionId && <p className="text-xs text-dim">Configurações individuais existentes têm prioridade na respectiva camada.</p>}
  </div>
}
