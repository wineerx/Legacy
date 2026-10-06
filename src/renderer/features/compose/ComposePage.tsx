import { useMemo, useState } from 'react'
import { useMascotSignal } from '../../components/brand/MascotProvider'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PenSquare } from 'lucide-react'
import type { CoverTextSpec, GridItem } from '@shared/types'
import { call, mediaUrl } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { peekComposeSelection, clearComposeSelection } from '../../lib/selection'
import { loadImage, renderCoverPng, renderBannerPng } from '../../lib/canvas'
import { Button, EmptyState, Input, Textarea, Toggle, Checkbox, DeliveryTime, deliveryError, useToast } from '../../components/ui'
import { zonedToUtc } from '@shared/schedule'
import type { PageProps } from '../../routes'
import { CoverEditor, DEFAULT_TEXT } from './CoverEditor'
import { BannerEditor, type BannerState } from './BannerEditor'
import { BatchReviewModal } from './BatchReviewModal'
import { ComposePreview } from './ComposePreview'
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
  const account = useQuery({queryKey:['instagram-account',workspace.id],queryFn:()=>call('accounts.instagram',{workspaceId:workspace.id})})
  const [instagram,setInstagram]=useState(false)
  // TikTok não tem conta conectada: só entra no lote quando marcado.
  const [tiktok,setTiktok]=useState(false)
  const [delivery,setDelivery]=useState('')
  const [interval,setInterval]=useState(60)
  const [cleanup,setCleanup]=useState(false)
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
  const blockReason = assets.isLoading ? 'Carregando vídeos…' : assets.isError ? 'Não foi possível carregar os vídeos. Volte à Biblioteca.' : !items.length ? 'Nenhum vídeo disponível neste lote.' : !instagram && !tiktok ? 'Selecione um destino.' : instagram && !account.data ? 'Conecte uma conta Instagram.' : instagram && items.some(i=>!i.postId) ? 'Instagram exige uma URL pública de origem. Use vídeos baixados pela grade de Perfis.' : instagram && (cover || bannerActive) ? 'Capas e banners locais ainda não podem ser publicados com Instagram Login. Use o original online ou exporte para postagem manual.' : instagram && captions.some(c=>c.length>2200) ? 'Instagram permite legendas de até 2200 caracteres.' : bannerActive && !(banner.startS >= 0 && banner.endS > banner.startS) ? 'O fim do banner precisa ser depois do início.' : instagram ? deliveryError(delivery,workspace.timeZone,new Date(),items.length,interval) : undefined

  const edited = Boolean(cover) || bannerActive
  const run = useMutation({
    mutationFn: async () => {
      if(blockReason) throw new Error(blockReason)
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
      // Capa vira o primeiro frame do vídeo; o Instagram usa esse frame como miniatura do Reel.
      const versionIds: Record<string, string> = {}
      for (const [k, it] of items.entries()) {
        try {
          const p = prepared[k]
          const coverVersionId = cover && p.cover ? (await call('versions.saveCover', { workspaceId: workspace.id, assetId: it.id, templateId: cover.id, png: p.cover })).versionId : undefined
          if (coverVersionId || p.banner) {
            const bannerInput = p.banner ? { png: p.banner, startMs: Math.round(banner.startS * 1000), endMs: Math.round(banner.endS * 1000) } : undefined
            versionIds[it.id] = (await call('versions.prepareVideo', { workspaceId: workspace.id, assetId: it.id, banner: bannerInput, coverVersionId })).versionId
          }
        } catch (e) { throw itemError(e, k, items.length, it.caption ?? it.id) }
      }
      if(instagram){
        const [date,time]=delivery.split('T')
        await call('compose.scheduleInstagram',{workspaceId:workspace.id,assetIds:items.map(i=>i.id),accountId:account.data!.id,accountRevision:account.data!.revision,firstAt:zonedToUtc(date,time,workspace.timeZone).toISOString(),intervalMin:interval,captions:Object.fromEntries(items.map((i,k)=>[i.id,captions[k]])),cleanupAfterPublish:cleanup,versionIds:edited ? versionIds : undefined})
      }
      if(!tiktok) return
      try { return await call('export.tiktok', { workspaceId: workspace.id, assetIds: items.map((i) => i.id), captions: Object.fromEntries(items.map((i, k) => [i.id, captions[k]])), stripMetadata, remindAt: reminders }) }
      catch(e) { if(instagram) throw new Error(`Instagram já foi enfileirado. A exportação TikTok falhou: ${e instanceof Error ? e.message : 'verifique a Fila'}`);throw e }
    },
    onSuccess: () => {
      clearComposeSelection(); setReviewOpen(false)
      const body = instagram && tiktok ? 'Instagram agendado e pasta TikTok em preparo. Acompanhe em Fila.' : instagram ? `Publicação agendada em @${account.data?.username}. Acompanhe em Fila.` : 'Pasta para postagem manual no TikTok em preparo. Ela abre pelas notificações.'
      toast.show({ title: 'Lote na fila', body }); navigate('queue')
    },
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
        <section className="grid gap-3 rounded-card border border-line bg-panel p-4"><h2 className="text-sm font-semibold">Publicar em</h2><Checkbox label={account.data ? `Instagram — @${account.data.username}` : 'Instagram — conectar conta'} description={account.isLoading ? 'Consultando conexão…' : account.isError ? 'Falha ao consultar conta. Abra Contas para tentar novamente.' : account.data ? 'Publicação de Reels pela API, com vídeo original online.' : 'Conecte uma conta Business ou Creator em Contas.'} checked={instagram} disabled={!account.data} onChange={e=>setInstagram(e.target.checked)} />{!account.data && <Button size="sm" onClick={()=>navigate('accounts')}>Conectar uma conta</Button>}<Checkbox label="TikTok — exportação manual" description="Sem conta conectada: o Legacy prepara vídeo, capa e legenda numa pasta; a postagem é feita por você no app oficial." checked={tiktok} onChange={e=>setTiktok(e.target.checked)} />{instagram && <><DeliveryTime value={delivery} onChange={setDelivery} timeZone={workspace.timeZone} count={items.length} intervalMin={interval} /><Input label="Intervalo entre publicações (min)" type="number" min={15} max={10080} value={interval} onChange={e=>setInterval(Number(e.target.value))}/><Checkbox label="Apagar a cópia após publicação confirmada" description="O histórico permanece; arquivos em uso são mantidos." checked={cleanup} onChange={e=>setCleanup(e.target.checked)} /></>}<p className="text-xs text-dim">Uma conta Instagram por workspace. Troque o workspace para usar outra conta.</p></section>
        <Textarea label="Legenda base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="Legenda aplicada a todos os vídeos" />
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
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <ComposePreview workspaceId={workspace.id} items={items} cover={cover} banner={banner} />
        <Button variant="primary" loading={run.isPending} disabledReason={blockReason} onClick={() => setReviewOpen(true)}>Revisar lote</Button>
        {blockReason && <p role="status" className="text-xs text-danger-fg">{blockReason}</p>}
      </aside>
      <BatchReviewModal open={reviewOpen} onOpenChange={setReviewOpen} items={items} captions={captions} reminders={reminders} timeZone={workspace.timeZone}
        coverName={cover?.name ?? null} bannerOn={bannerActive} stripMetadata={stripMetadata} busy={run.isPending} blockReason={blockReason} instagram={instagram ? account.data?.username : undefined} delivery={delivery} intervalMin={interval} tiktok={tiktok} onConfirm={() => run.mutate()} />
    </div>
  )
}
