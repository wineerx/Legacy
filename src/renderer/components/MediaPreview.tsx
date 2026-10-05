import { useState } from 'react'
import type { GridItem } from '@shared/types'
import { mediaUrl } from '../lib/api'
import { Button, Modal } from './ui'
import { formatCompact as formatCount } from '@shared/format'

function remoteVideo(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['cdninstagram.com', 'fbcdn.net'].some(h => u.hostname.endsWith(`.${h}`)) ? u.href : null
  } catch { return null }
}

export function MediaPreview({ item, onClose }: { item: GridItem; onClose(): void }) {
  const [failed, setFailed] = useState(false)
  const source = item.filePath ? mediaUrl(item.filePath) : remoteVideo(item.videoUrl)
  return <Modal open onOpenChange={open => !open && onClose()} title="Visualizar no Legacy" description={item.caption?.slice(0, 180) || 'Prévia do conteúdo selecionado.'}
    footer={<>{item.permalink && <Button onClick={() => window.open(item.permalink!, '_blank')}>Ver origem no Instagram</Button>}<Button onClick={onClose}>Fechar player</Button></>}>
    {source && !failed ? <video aria-label="Player de vídeo" controls playsInline preload="metadata" src={source} poster={item.thumbnailPath ? mediaUrl(item.thumbnailPath) : undefined} onError={() => setFailed(true)} className="mx-auto max-h-[55vh] w-full rounded-ctl bg-black object-contain" />
      : <div className="flex flex-col gap-3">{item.thumbnailPath && <img src={mediaUrl(item.thumbnailPath)} alt="Prévia do post" className="mx-auto max-h-[55vh] max-w-full rounded-ctl object-contain" />}<p role="status" className="text-sm text-dim">{failed ? 'Não foi possível reproduzir. A URL pode ter expirado ou o formato não é suportado. Faça nova busca ou baixe o vídeo e tente novamente.' : 'Este post ainda não tem vídeo disponível para reprodução. Carregue a grade ou baixe o vídeo quando disponível.'}</p></div>}
    {source && !item.filePath && <p className="mt-2 text-xs text-dim">Prévia online; depende da conexão e da validade da URL. Nenhum arquivo é salvo ao abrir.</p>}
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-dim"><span>Views: {formatCount(item.metrics.views)}</span><span>Curtidas: {formatCount(item.metrics.likes)}</span><span>Comentários: {formatCount(item.metrics.comments)}</span>{item.sourceProfile && <span>Origem: @{item.sourceProfile}</span>}</div>
    {!!item.publishedAccounts?.length && <p className="mt-2 text-xs">Já publicado por: {item.publishedAccounts.map(a => `@${a}`).join(', ')}</p>}
  </Modal>
}
