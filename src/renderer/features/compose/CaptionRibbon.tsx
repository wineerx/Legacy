import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CAPTION_PRESETS } from '@shared/captions'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Pills, useToast } from '../../components/ui'
import type { PageProps } from '../../routes'

export function CaptionRibbon({ onUse, navigate, profileId, defaultMode = 'presets' }: { onUse?(caption: string): void; navigate?: PageProps['navigate']; profileId?: string; defaultMode?: 'presets' | 'ranked' }) {
  const { workspace } = useWorkspace()
  const toast = useToast()
  const [mode, setMode] = useState<'presets' | 'ranked'>(defaultMode)
  const [sortBy, setSortBy] = useState<'views' | 'likes' | 'comments'>('views')
  const top = useQuery({ queryKey: ['captions', workspace.id, sortBy, profileId], queryFn: () => call('captions.top', { workspaceId: workspace.id, sortBy, profileId }), enabled: mode === 'ranked' })
  const apply = async (text: string) => {
    if (onUse) { onUse(text); toast.show({ title: 'Modelo aplicado à legenda base', body: 'Edite os campos entre colchetes antes de exportar.' }); return }
    try { await navigator.clipboard.writeText(text); toast.show({ title: 'Legenda copiada' }) }
    catch { toast.show({ title: 'Não foi possível copiar. Selecione o texto e copie pelo teclado.', tone: 'error' }) }
  }
  return <section data-tour="captions" className="min-w-0 rounded-card border border-line bg-panel p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Legendas do Legacy</h2><Pills<'presets' | 'ranked'> label="Fonte das legendas" value={mode} onChange={setMode} options={[{ value: 'presets', label: 'Modelos prontos' }, { value: 'ranked', label: 'Reels em destaque' }]} /></div>
    <p className="mt-2 text-xs text-dim">{mode === 'presets' ? 'Modelos editáveis para testar perguntas, contexto e identificação com o público. Não possuem promessa de engajamento.' : top.data?.note ?? 'Carregando legendas dos conteúdos analisados…'}</p>
    {mode === 'ranked' && <div className="mt-3"><Pills<'views' | 'likes' | 'comments'> label="Métrica das legendas" value={sortBy} onChange={setSortBy} options={[{ value: 'views', label: 'Visualizações' }, { value: 'likes', label: 'Curtidas' }, { value: 'comments', label: 'Comentários' }]} /></div>}
    <div tabIndex={0} aria-label="Faixa horizontal de legendas" className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
      {mode === 'presets' ? CAPTION_PRESETS.map((p) => <article key={p.id} className="flex w-72 shrink-0 snap-start flex-col rounded-ctl border border-line bg-app p-3"><h3 className="text-sm font-medium">{p.title}</h3><p className="my-3 flex-1 whitespace-pre-wrap text-xs text-dim">{p.text}</p><Button size="sm" onClick={() => void apply(p.text)}>{onUse ? 'Usar modelo' : 'Copiar modelo'}</Button></article>) : top.data?.items.map((p, index) => <article key={p.id} className="flex w-80 shrink-0 snap-start flex-col rounded-ctl border border-line bg-app p-3"><h3 className="text-sm font-medium">{index + 1}. @{p.username}</h3><p className="mt-1 text-xs text-dim">{p.value?.toLocaleString('pt-BR')} {sortBy === 'views' ? 'visualizações' : sortBy === 'likes' ? 'curtidas' : 'comentários'} · {p.source === 'csv' ? 'Métricas importadas' : 'Dados do provedor'}</p><p className="my-3 max-h-48 flex-1 overflow-auto whitespace-pre-wrap text-xs text-dim">{p.text}</p><div className="flex gap-2"><Button size="sm" onClick={() => void apply(p.text ?? '')}>{onUse ? 'Usar como base' : 'Copiar legenda'}</Button><Button size="sm" onClick={() => window.open(p.permalink, '_blank')}>Ver original</Button></div></article>)}
    </div>
    {mode === 'ranked' && top.isError && <p role="alert" className="text-sm text-danger-fg">Não foi possível carregar o ranking.</p>}
    {mode === 'ranked' && !top.isLoading && !top.isError && !top.data?.items.length && <div className="text-sm text-dim"><p>Ainda não há legendas com métricas disponíveis. Adicione as referências e busque reels via Apify ou importe CSV/JSON com legendas e métricas.</p>{navigate && <Button size="sm" className="mt-2" onClick={() => navigate('profiles')}>Analisar perfis</Button>}</div>}
  </section>
}
