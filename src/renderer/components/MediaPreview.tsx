import { CollapsibleCard } from './ui'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { GridItem } from '@shared/types'
import { call, mediaUrl } from '../lib/api'
import { useWorkspace } from '../lib/workspace'
import { useMediaPreferences } from '../lib/media-preferences'
import { Button, Modal } from './ui'
import { formatCompact as formatCount, formatDuration } from '@shared/format'

function remoteVideo(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['cdninstagram.com', 'fbcdn.net'].some(h => u.hostname.endsWith(`.${h}`)) ? u.href : null
  } catch { return null }
}
const states: Record<string, string> = { published: 'Publicado', scheduled: 'Agendado', failed: 'Falhou', running: 'Em execução', exported: 'Exportado para publicação manual' }
export function MediaPreview({ item, onClose }: { item: GridItem; onClose(): void }) {
  const [failed, setFailed] = useState(false)
  const [offset, setOffset] = useState(0)
  const { workspace } = useWorkspace()
  const prefs = useMediaPreferences()
  const assetId = item.kind === 'asset' ? item.id : item.assetId
  const details = useQuery({ queryKey: ['media-details', workspace.id, assetId, offset], queryFn: () => call('library.details', { workspaceId: workspace.id, id: assetId!, offset }), enabled: Boolean(assetId) })
  const frame = useQuery({ queryKey: ['media-first-frame', workspace.id, assetId], queryFn: () => call('library.frame', { workspaceId: workspace.id, assetId: assetId!, atMs: 0 }), enabled: Boolean(assetId) && !prefs.showBanner && !item.firstFramePath })
  const d = details.data
  const original = item.filePath ? mediaUrl(item.filePath) : remoteVideo(item.videoUrl)
  const source = prefs.showBanner && d?.bannerPath ? mediaUrl(d.bannerPath) : original
  const poster = prefs.showBanner ? item.thumbnailPath : item.firstFramePath ?? frame.data?.path
  const at = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone: workspace.timeZone })
  return <Modal open onOpenChange={open => !open && onClose()} title="Visualizar no Legacy" description={item.caption?.slice(0, 180) || 'Prévia do conteúdo selecionado.'}
    footer={<>{item.permalink && <Button onClick={() => window.open(item.permalink!, '_blank')}>Ver origem no Instagram</Button>}<Button onClick={onClose}>Fechar player</Button></>}>
    <label className="mb-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={prefs.showBanner} onChange={e => { setFailed(false); prefs.save.mutate({ key: 'mediaShowBanner', value: e.target.checked }) }} />Exibir banner</label>
    {source && !failed ? <video key={source} aria-label="Player de vídeo" controls playsInline preload="metadata" src={source} poster={poster ? mediaUrl(poster) : undefined} onLoadedMetadata={e => { e.currentTarget.muted = false; e.currentTarget.volume = 1 }} onError={() => setFailed(true)} className="mx-auto max-h-[45vh] w-full rounded-ctl bg-black object-contain" />
      : <div className="flex flex-col gap-3">{poster && <img src={mediaUrl(poster)} alt="Prévia do post" className="mx-auto max-h-[45vh] max-w-full rounded-ctl object-contain" />}<p role="status" className="text-sm text-dim">{failed ? 'Não foi possível reproduzir. A URL pode ter expirado ou o formato não é suportado. Faça nova busca ou baixe o vídeo e tente novamente.' : 'Este post ainda não tem vídeo disponível para reprodução. Carregue a grade ou baixe o vídeo quando disponível.'}</p></div>}
    {!prefs.showBanner && <p className="mt-2 text-xs text-dim">Mostra o arquivo original e seu primeiro frame. Sobreposições já gravadas na fonte permanecem.</p>}
    {source && !item.filePath && <p className="mt-2 text-xs text-dim">Prévia online; depende da conexão e da validade da URL. Nenhum arquivo é salvo ao abrir.</p>}
    <section className="mt-4 border-t border-line pt-3"><h2 className="text-sm font-semibold">Métricas</h2><div className="mt-2 flex flex-wrap gap-4 text-xs text-dim"><span>Views: {formatCount(item.metrics.views)}</span><span>Curtidas: {formatCount(item.metrics.likes)}</span><span>Comentários: {formatCount(item.metrics.comments)}</span><span>Compartilhamentos: —</span></div><p className="mt-1 text-xs text-dim">Atualizadas: {d?.metricsUpdatedAt ? at(d.metricsUpdatedAt) : '—'}</p></section>
    {assetId && <section className="mt-4 border-t border-line pt-3"><h2 className="text-sm font-semibold">Arquivo e origem</h2>
      {details.isLoading ? <p role="status" className="text-xs text-dim">Verificando arquivo…</p> : details.isError ? <div role="alert" className="text-xs text-danger-fg">Não foi possível verificar o arquivo. <button onClick={() => void details.refetch()}>Tentar novamente</button></div> : d && <dl className="mt-2 grid grid-cols-2 gap-3 break-words text-xs">
        {Object.entries({ Nome: d.name, Tamanho: `${(d.sizeBytes / 1024 ** 2).toFixed(1)} MB`, Duração: formatDuration(d.durationMs), Resolução: `${d.width}×${d.height}`, Áudio: d.audioCodec === 'none' ? 'Ausente' : d.audioCodec ?? 'Não verificado', Origem: d.sourceProfile ? `Instagram · @${d.sourceProfile}` : d.origin === 'pc' ? 'Computador' : 'Instagram', Importado: at(d.importedAt), 'URL original': d.permalink ?? '—' }).map(([key, value]) => <div key={key}><dt className="text-dim">{key}</dt><dd className="mt-1">{value}</dd></div>)}
      </dl>}
    </section>}
    {d && <><section className="mt-4 border-t border-line pt-3"><h2 className="text-sm font-semibold">Publicações e usos · {d.publicationTotal} confirmado(s)</h2>{d.publications.length ? <ul className="mt-2 divide-y divide-line">{d.publications.map(p => <li key={p.id} className="py-2 text-xs"><div className="flex flex-wrap justify-between gap-2"><span>{p.platform}{p.account ? ` · @${p.account}` : ''}</span><span>{states[p.state] ?? p.state}</span></div><p className="mt-1 text-dim">{at(p.at)}</p>{p.error && <p className="mt-1 text-danger-fg">{p.error}</p>}</li>)}</ul> : <p className="mt-2 text-xs text-dim">Esta mídia ainda não foi utilizada.</p>}
      {d.publicationTotal > 50 && <div className="mt-2 flex gap-2"><Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior</Button><Button size="sm" disabled={offset + 50 >= d.publicationTotal} onClick={() => setOffset(offset + 50)}>Próximas publicações</Button></div>}
    </section><CollapsibleCard className="mt-4" title={<>Histórico da mídia</>}><ol className="border-l border-line pl-3">{d.timeline.map((event, n) => <li key={n} className="mb-3 text-xs"><time className="text-dim">{at(event.at)}</time><p>{event.label}</p></li>)}</ol></CollapsibleCard></>}
    {!d && !!item.publishedAccounts?.length && <p className="mt-2 text-xs">Já publicado por: {item.publishedAccounts.map(a => `@${a}`).join(', ')}</p>}
  </Modal>
}
