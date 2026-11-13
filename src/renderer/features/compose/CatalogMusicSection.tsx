import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { GridItem } from '@shared/types'
import { audioMapKey, parseAudioMap, DEFAULT_AUDIO_VOLUME, DEFAULT_VIDEO_VOLUME, type CatalogAudioChoice, type CatalogAudioTrack } from '@shared/catalog-audio'
import { call } from '../../lib/api'
import { Button, Input } from '../../components/ui'

export type SelectedMusic = CatalogAudioChoice & { title: string; artist: string | null }
type Proposal = { assetId: string; label: string; query: string; tracks: CatalogAudioTrack[]; pick: string | null; audioVolume: number; videoVolume: number; error?: string }

const duration = (ms: number | null) => ms == null ? '' : `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`
const clamp = (v: number, min: number, fallback: number) => Number.isFinite(v) ? Math.min(100, Math.max(min, Math.round(v))) : fallback
const nameOf = (it: GridItem) => it.sourceName ?? it.caption ?? it.id

function TrackLine({ track }: { track: CatalogAudioTrack }) {
  return <div className="min-w-0 flex-1">
    <p className="truncate text-sm">{track.title}{track.artist ? ` · ${track.artist}` : ''} <span className="text-xs text-dim">{duration(track.durationMs)}</span></p>
    {track.previewUrl
      ? <audio controls preload="none" src={track.previewUrl} className="mt-1 h-8 w-full" aria-label={`Prévia de ${track.title}`} />
      : <p className="text-xs text-dim">Prévia indisponível{track.instagramLink ? <> · <a href={track.instagramLink} target="_blank" rel="noreferrer" className="underline">ouvir no Instagram</a></> : null}</p>}
  </div>
}

/** Music from Meta's catalog. Only shown for accounts connected with Facebook Login. */
export function CatalogMusicSection({ workspaceId, accountId, items, value, onChange }: {
  workspaceId: string; accountId: string; items: GridItem[]; value: Record<string, SelectedMusic>; onChange(next: Record<string, SelectedMusic>): void
}) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<'all' | string>('all')
  const [audioVolume, setAudioVolume] = useState(DEFAULT_AUDIO_VOLUME)
  const [videoVolume, setVideoVolume] = useState(DEFAULT_VIDEO_VOLUME)
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [mapError, setMapError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const search = useMutation({ mutationFn: (q: string) => call('audio.searchCatalog', { workspaceId, accountId, query: q }) })

  const choose = (track: CatalogAudioTrack) => {
    const music = { audioId: track.id, title: track.title, artist: track.artist, audioVolume, videoVolume }
    const next = { ...value }
    for (const it of items) if (target === 'all' || it.id === target) next[it.id] = music
    onChange(next)
  }
  const importMap = useMutation({
    mutationFn: async (text: string) => {
      const entries = parseAudioMap(text)
      const byName = new Map(items.map(it => [audioMapKey(nameOf(it)), it]))
      const found: Proposal[] = [], missing: string[] = []
      // One search at a time: the catalog is rate limited per account.
      for (const e of entries) {
        const it = byName.get(audioMapKey(e.file))
        if (!it) { missing.push(e.file); continue }
        try {
          const tracks = (await call('audio.searchCatalog', { workspaceId, accountId, query: e.query })).slice(0, 5)
          found.push({ assetId: it.id, label: nameOf(it), query: e.query, tracks, pick: tracks[0]?.id ?? null, audioVolume: e.audioVolume, videoVolume: e.videoVolume, ...(tracks.length ? {} : { error: 'Nenhuma faixa no catálogo da Meta para esta busca.' }) })
        } catch (err) { found.push({ assetId: it.id, label: nameOf(it), query: e.query, tracks: [], pick: null, audioVolume: e.audioVolume, videoVolume: e.videoVolume, error: err instanceof Error ? err.message : 'Falha na busca.' }) }
      }
      return { found, missing }
    },
    onSuccess: r => { setProposals(r.found); setUnmatched(r.missing); setMapError(r.found.length ? '' : 'Nenhum nome do mapa corresponde aos vídeos deste lote.') },
    onError: e => setMapError(e instanceof Error ? e.message : 'Não foi possível ler o mapa.')
  })
  const applyProposals = () => {
    const next = { ...value }
    for (const p of proposals ?? []) {
      const track = p.tracks.find(t => t.id === p.pick)
      if (track) next[p.assetId] = { audioId: track.id, title: track.title, artist: track.artist, audioVolume: p.audioVolume, videoVolume: p.videoVolume }
    }
    onChange(next); setProposals(null); setUnmatched([])
  }
  const assigned = items.filter(it => value[it.id])

  return <section className="grid gap-4 rounded-card border border-line bg-panel p-4" aria-label="Música do catálogo Meta">
    <div>
      <h2 className="text-sm font-semibold">Música do catálogo Meta</h2>
      <p className="mt-1 text-xs text-dim">A faixa é anexada pelo Instagram na publicação; o arquivo de vídeo não muda. Nem toda música do app está no catálogo da API, e o trecho é escolhido pela Meta.</p>
    </div>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (query.trim()) search.mutate(query.trim()) }}>
      <div className="min-w-48 flex-1"><Input label="Buscar música" value={query} maxLength={200} placeholder="Artista ou faixa" onChange={e => setQuery(e.target.value)} /></div>
      <Button type="submit" loading={search.isPending} disabled={!query.trim()}>Buscar</Button>
    </form>
    <div className="flex flex-wrap gap-3">
      <Input label="Volume da música" type="number" min={1} max={100} value={audioVolume} onChange={e => setAudioVolume(clamp(Number(e.target.value), 1, DEFAULT_AUDIO_VOLUME))} />
      <Input label="Volume do vídeo" type="number" min={0} max={100} value={videoVolume} onChange={e => setVideoVolume(clamp(Number(e.target.value), 0, DEFAULT_VIDEO_VOLUME))} />
      {items.length > 1 && <label className="text-sm">Aplicar em
        <select aria-label="Aplicar música em" className="ml-2 rounded border border-line bg-panel p-2" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="all">Todos os vídeos</option>
          {items.map(it => <option key={it.id} value={it.id}>{nameOf(it)}</option>)}
        </select>
      </label>}
    </div>
    {search.isError && <p role="alert" className="text-xs text-danger-fg">{search.error instanceof Error ? search.error.message : 'Falha na busca.'}</p>}
    {search.data && (search.data.length === 0
      ? <p role="status" className="text-sm text-dim">Nenhuma faixa no catálogo da Meta para esta busca. Tente outro termo.</p>
      : <ul className="grid max-h-72 gap-2 overflow-y-auto" aria-label="Resultados da busca">
          {search.data.map(t => <li key={t.id} className="flex items-center gap-3 rounded-ctl border border-line p-2">
            <TrackLine track={t} />
            <Button size="sm" onClick={() => choose(t)}>Usar</Button>
          </li>)}
        </ul>)}
    <div className="grid gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={importMap.isPending} onClick={() => file.current?.click()}>Importar mapa de músicas (JSON)</Button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" aria-label="Arquivo mapa de músicas" onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          if (f.size > 1024 * 1024) { setMapError('O mapa deve ter até 1 MB.'); return }
          importMap.mutate(await f.text())
        }} />
        <span className="text-xs text-dim">Formato: {'{ "video.mp4": { "busca": "artista faixa", "volume_musica": 100, "volume_video": 0 } }'}</span>
      </div>
      {mapError && <p role="alert" className="text-xs text-danger-fg">{mapError}</p>}
      {proposals && <div className="grid gap-2 rounded-ctl border border-line p-3" role="group" aria-label="Confirmar músicas do mapa">
        <p className="text-sm font-semibold">Confira as músicas antes de aplicar</p>
        {proposals.map((p, k) => <div key={p.assetId} className="grid gap-1 border-b border-line pb-2 last:border-0">
          <p className="text-xs"><strong>{p.label}</strong> · busca “{p.query}” · música {p.audioVolume} · vídeo {p.videoVolume}</p>
          {p.error ? <p className="text-xs text-danger-fg">{p.error}</p> : <>
            <select aria-label={`Faixa para ${p.label}`} className="rounded border border-line bg-panel p-2 text-sm" value={p.pick ?? ''} onChange={e => setProposals(proposals.map((q, j) => j === k ? { ...q, pick: e.target.value || null } : q))}>
              {p.tracks.map(t => <option key={t.id} value={t.id}>{t.title}{t.artist ? ` · ${t.artist}` : ''}</option>)}
              <option value="">Sem música</option>
            </select>
            {p.tracks.find(t => t.id === p.pick) && <TrackLine track={p.tracks.find(t => t.id === p.pick)!} />}
          </>}
        </div>)}
        {unmatched.length > 0 && <p className="text-xs text-dim">Sem vídeo correspondente neste lote: {unmatched.join(', ')}</p>}
        <div className="flex gap-2"><Button variant="primary" size="sm" onClick={applyProposals}>Aplicar músicas</Button><Button size="sm" onClick={() => { setProposals(null); setUnmatched([]) }}>Cancelar</Button></div>
      </div>}
    </div>
    {assigned.length > 0 && <ul className="grid gap-1 border-t border-line pt-3" aria-label="Músicas escolhidas">
      {assigned.map(it => { const m = value[it.id]; return <li key={it.id} className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate"><strong>{nameOf(it)}</strong> · {m.title}{m.artist ? ` · ${m.artist}` : ''} · música {m.audioVolume} · vídeo {m.videoVolume}</span>
        <Button size="sm" onClick={() => { const next = { ...value }; delete next[it.id]; onChange(next) }}>Remover</Button>
      </li> })}
    </ul>}
  </section>
}
