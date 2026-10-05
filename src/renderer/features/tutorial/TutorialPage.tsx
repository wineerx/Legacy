import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { REFERENCE_PROFILES } from '@shared/captions'
import { call, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Input, useToast } from '../../components/ui'
import type { PageProps } from '../../routes'
import { useTutorial } from './TutorialProvider'
import { CaptionRibbon } from '../compose/CaptionRibbon'

const GUIDE = [
  ['Escolha uma proposta clara', 'Defina um tema que você consegue produzir com frequência, um público específico e o tipo de utilidade ou entretenimento que oferece. Um nome legível, avatar consistente e bio objetiva facilitam reconhecer seu perfil.'],
  ['Crie a conta na plataforma oficial', 'A criação da conta é feita no Instagram. Configure segurança, dados de recuperação e a identificação adequada do perfil. No Legacy, salve o plano e adicione o link para organizar o trabalho.'],
  ['Observe referências com contexto', 'Estude várias publicações de cada referência: abertura do vídeo, duração, assunto, edição, legenda e conversa nos comentários. As seis URLs abaixo foram fornecidas pelo usuário; seu conteúdo e desempenho não foram verificados nesta entrega.'],
  ['Prepare conteúdo próprio ou autorizado', 'Monte um lote pequeno sobre o mesmo tema. Preserve a origem e os créditos necessários. Importe vídeos ou busque reels públicos pela integração Apify quando configurada. Reaproveitar não elimina a necessidade de contexto e autorização.'],
  ['Teste uma legenda por intenção', 'Use uma frase que contextualize o vídeo e uma pergunta relevante quando fizer sentido. Adapte os modelos do Legacy. Evite pedidos de interação sem relação com o conteúdo e não trate uma legenda de um reel popular como garantia de resultado.'],
  ['Revise a apresentação e a rotina', 'Na Biblioteca, selecione o lote, ajuste capa, banner e legenda no editor, revise e prepare a exportação. Escolha uma cadência que consiga sustentar. Lembretes ajudam a manter a rotina enquanto o computador estiver ativo.'],
  ['Publique e aprenda com os dados', 'Use a plataforma oficial para a publicação manual. Traga métricas para o Legacy e compare conjuntos de posts com a mesma métrica. Observe evolução, comentários úteis e padrões de temas; resultados podem variar e alto engajamento não é garantido.']
]

export function TutorialPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  return <Guide key={workspace.id} navigate={navigate} />
}
function Guide({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const tour = useTutorial()
  const qc = useQueryClient()
  const toast = useToast()
  const saved = useQuery({ queryKey: ['profile-plan', workspace.id], queryFn: () => call('tutorial.planGet', { workspaceId: workspace.id }) })
  const [plan, setPlan] = useState({ username: '', niche: '', audience: '', bio: '', cadence: '3 posts por semana para testar' })
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { if (!hydrated && saved.isSuccess) { if (saved.data) setPlan(saved.data); setHydrated(true) } }, [saved.data, saved.isSuccess, hydrated])
  const save = useMutation({ mutationFn: () => call('tutorial.planSave', { workspaceId: workspace.id, ...plan }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['profile-plan'] }); toast.show({ title: 'Plano de perfil salvo' }) }, onError: (e) => toast.show({ title: 'Não foi possível salvar', body: e instanceof ApiError ? e.message : undefined, tone: 'error' }) })
  const reference = useMutation({ mutationFn: (url: string) => call('profiles.add', { workspaceId: workspace.id, url }), onSuccess: () => { void qc.invalidateQueries(); toast.show({ title: 'Referência adicionada aos Perfis', body: 'Selecione o perfil e busque reels quando a Apify estiver configurada.' }) }, onError: (e) => toast.show({ title: 'Não foi possível adicionar referência', body: e instanceof ApiError ? e.message : undefined, tone: 'error' }) })
  return <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
    <header><h1 className="text-xl font-semibold">Tutoriais do Legacy</h1><p className="mt-1 text-sm text-dim">Aprenda o fluxo do aplicativo e monte uma rotina de conteúdo.</p></header>
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-card border border-line bg-panel p-5"><h2 className="font-semibold">Conheça o aplicativo</h2><p className="my-3 text-sm text-dim">Um tour com destaques, foco por teclado e navegação suave por APIs, perfis, biblioteca, edição, fila e armazenamento.</p><p className="mb-3 text-xs text-dim">{tour.progress.app.completed ? 'Tutorial concluído. Você pode rever quando quiser.' : tour.progress.app.step > 0 ? `Pausado no passo ${tour.progress.app.step + 1}.` : '12 passos guiados.'}</p><div className="flex gap-2"><Button variant="primary" onClick={() => tour.start('app')}>{tour.progress.app.completed ? 'Rever tour do Legacy' : tour.progress.app.step ? 'Retomar tour do Legacy' : 'Iniciar tour do Legacy'}</Button><Button onClick={() => tour.start('app', true)}>Começar do início</Button></div></section>
      <section className="rounded-card border border-line bg-panel p-5"><h2 className="font-semibold">Monte um perfil de conteúdo</h2><p className="my-3 text-sm text-dim">Defina tema, público e rotina, estude referências, organize lotes e avalie resultados. O guia não promete crescimento ou engajamento.</p><p className="mb-3 text-xs text-dim">{tour.progress.profile.completed ? 'Guia concluído.' : '8 passos guiados e um plano editável.'}</p><Button variant="primary" onClick={() => tour.start('profile')}>Iniciar guia de perfil</Button></section>
    </div>
    <section data-tour="profile-plan" className="rounded-card border border-line bg-panel p-5"><h2 className="font-semibold">Seu plano de perfil</h2><p className="mt-1 text-xs text-dim">Rascunho salvo neste workspace. Salvar não cria uma conta no Instagram.</p>
      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Input label="Nome de usuário planejado" maxLength={30} value={plan.username} onChange={(e) => setPlan({ ...plan, username: e.target.value })} placeholder="meu.perfil" />
        <Input label="Tema do perfil" maxLength={160} value={plan.niche} onChange={(e) => setPlan({ ...plan, niche: e.target.value })} placeholder="Ex.: curiosidades explicadas em vídeos curtos" />
        <Input label="Público que você quer alcançar" maxLength={160} value={plan.audience} onChange={(e) => setPlan({ ...plan, audience: e.target.value })} />
        <Input label="Cadência inicial" maxLength={80} value={plan.cadence} onChange={(e) => setPlan({ ...plan, cadence: e.target.value })} />
        <div className="md:col-span-2"><Input label="Bio planejada" maxLength={150} value={plan.bio} onChange={(e) => setPlan({ ...plan, bio: e.target.value })} placeholder="O que o público encontra aqui e por que acompanhar" /></div>
        <div className="md:col-span-2"><Button type="submit" variant="primary" disabled={save.isPending || !hydrated}>Salvar plano de perfil</Button></div>
      </form>
      {saved.isError && <p role="alert" className="mt-3 text-sm text-danger-fg">Não foi possível carregar seu plano. Reabra esta tela para tentar novamente.</p>}
    </section>
    <section data-tour="references" className="rounded-card border border-line bg-panel p-5"><h2 className="font-semibold">Referências indicadas</h2><p className="mt-1 text-xs text-dim">Adicione o link ao Legacy para analisar. O cadastro não inicia uma busca paga. Legendas e rankings surgem depois da busca ou da importação de métricas.</p><div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{REFERENCE_PROFILES.map((p) => <article key={p.username} className="rounded-ctl border border-line p-3"><h3 className="text-sm font-medium">@{p.username}</h3><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => window.open(p.url, '_blank')}>Abrir Instagram</Button><Button size="sm" disabled={reference.isPending} onClick={() => reference.mutate(p.url)}>Adicionar referência</Button></div></article>)}</div></section>
    <CaptionRibbon navigate={navigate} />
    <section data-tour="profile-guide" className="rounded-card border border-line bg-panel p-5"><h2 className="font-semibold">Do plano à rotina de publicação</h2><ol className="mt-4 grid gap-4 md:grid-cols-2">{GUIDE.map(([title, body], i) => <li key={title} className="rounded-ctl border border-line p-4"><h3 className="text-sm font-semibold">{i + 1}. {title}</h3><p className="mt-2 text-sm leading-relaxed text-dim">{body}</p></li>)}</ol><div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => navigate('profiles')}>Abrir Perfis</Button><Button onClick={() => navigate('library')}>Abrir Biblioteca</Button><Button onClick={() => navigate('overview')}>Configurar APIs e ver indicadores</Button></div></section>
  </div>
}
