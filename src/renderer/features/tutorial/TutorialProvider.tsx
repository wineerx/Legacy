import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../../components/ui'
import { useWorkspace } from '../../lib/workspace'
import type { PageKey } from '../../routes'

type Kind = 'app' | 'profile'
type Step = { page: PageKey; target: string; title: string; body: string }
const appSteps: Step[] = [
  { page: 'overview', target: '[data-tour="dashboard"]', title: 'Seu painel de operação', body: 'Veja tarefas na fila, falhas, vídeos e perfis do workspace. Os indicadores atualizam a cada cinco segundos. Clique em um indicador para abrir a área correspondente.' },
  { page: 'overview', target: '[data-tour="integrations"]', title: 'Prepare as APIs', body: 'Em Configurar Apify, cadastre e teste sua chave. Ela permite buscar reels públicos. Instagram oficial e TikTok por API têm suas pendências explicadas aqui.' },
  { page: 'profiles', target: '[data-tour="profile-url"]', title: 'Adicione um perfil', body: 'Cole a URL ou @usuário do Instagram e clique em Adicionar perfil. O cadastro do link não inicia uma cobrança nem um download.' },
  { page: 'profiles', target: '[data-tour="profiles-content"]', title: 'Busque e analise reels', body: 'Selecione o perfil e use Baixar vídeos do perfil. Defina um limite de 1 a 100 e acompanhe cada tarefa na Fila. Ordene apenas os resultados carregados pelas métricas disponíveis.' },
  { page: 'library', target: '[data-tour="library-import"]', title: 'Guarde seu conteúdo', body: 'Importe MP4, MOV ou M4V, ou aguarde os downloads. O Legacy valida os vídeos, evita duplicados pelo conteúdo e gera miniaturas.' },
  { page: 'library', target: '[data-tour="library-selection"]', title: 'Selecione o lote', body: 'Marque vídeos individualmente ou selecione a página. Preparar lote abre o editor com os itens selecionados. O tour explica o fluxo sem selecionar ou exportar arquivos por você.' },
  { page: 'compose', target: '[data-tour="compose"]', title: 'Edite antes de exportar', body: 'Depois de selecionar um lote, escreva a legenda base, ajuste cada item, capa e banner. Revise o resultado. Nenhuma postagem real é feita por este tour.' },
  { page: 'tutorial', target: '[data-tour="captions"]', title: 'Use e compare legendas', body: 'A faixa horizontal tem modelos editáveis e legendas de reels com métricas disponíveis. No editor, Usar modelo preenche a legenda base. Substitua os campos entre colchetes antes de publicar.' },
  { page: 'queue', target: '[data-tour="queue"]', title: 'Acompanhe cada tarefa', body: 'Veja buscas, downloads, edição, exportações e entregas de webhooks. Tarefas na fila podem ser canceladas; falhas podem ser corrigidas e tentadas novamente.' },
  { page: 'notifications', target: '[data-tour="notifications"]', title: 'Receba e consulte os avisos', body: 'Conclusões, falhas e lembretes ficam na central. Em Configurar alertas você escolhe os avisos e testa o alerta do Windows. Clique em uma ação para ir à fila ou à pasta exportada.' },
  { page: 'settings', target: '[data-tour="storage"]', title: 'Escolha onde guardar vídeos', body: 'Altere a pasta dos novos vídeos ou restaure o padrão. Os arquivos existentes continuam no local anterior. Inclua todos os destinos usados no backup.' },
  { page: 'tutorial', target: '[data-tour="profile-guide"]', title: 'Seu próximo passo', body: 'Use o guia de perfil para definir tema, público e rotina. O Legacy organiza o trabalho; a criação da conta e a publicação manual acontecem na plataforma oficial. Você pode repetir este tour quando precisar.' }
]
const profileSteps: Step[] = [
  { page: 'tutorial', target: '[data-tour="profile-plan"]', title: 'Defina a proposta do perfil', body: 'Escreva o tema, quem você quer alcançar e uma bio curta. Prefira uma promessa específica que você consiga cumprir. Salve o plano no workspace para retomar depois.' },
  { page: 'tutorial', target: '[data-tour="references"]', title: 'Estude referências de conteúdo', body: 'Use os seis perfis indicados como referências. Adicionar referência cadastra o link no Legacy. Observe tema, gancho, contexto e conversa nos comentários; não conclua que toda a performance vem da legenda.' },
  { page: 'profiles', target: '[data-tour="profiles-content"]', title: 'Compare dados realmente disponíveis', body: 'Busque um perfil via Apify ou importe métricas. Registre de onde veio o conteúdo. Use um conjunto de posts e reconheça quando as métricas estiverem ausentes ou incompletas.' },
  { page: 'library', target: '[data-tour="library-selection"]', title: 'Monte um lote pequeno', body: 'Escolha poucos vídeos de um mesmo tema, com arquivos e créditos adequados. Conteúdo próprio ou autorizado permite criar uma identidade consistente e revisar com atenção.' },
  { page: 'tutorial', target: '[data-tour="captions"]', title: 'Teste legendas com intenção', body: 'Use uma pergunta ligada ao vídeo, contexto útil ou uma frase de identificação. Altere uma variável por vez e evite promessas enganosas. Os modelos são hipóteses para testar, não fórmulas garantidas.' },
  { page: 'compose', target: '[data-tour="compose"]', title: 'Mantenha uma apresentação reconhecível', body: 'No lote selecionado, prepare capa, legenda e banner legível. Verifique a prévia e os créditos. Publique manualmente pelo aplicativo oficial usando a pasta exportada quando necessário.' },
  { page: 'overview', target: '[data-tour="profile-metrics"]', title: 'Aprenda com os resultados', body: 'Compare visualizações, curtidas e comentários dos conteúdos carregados. Não misture reproduções e alcance. Analise vários posts ao longo do tempo, em vez de copiar um único resultado viral.' },
  { page: 'tutorial', target: '[data-tour="profile-guide"]', title: 'Repita uma rotina sustentável', body: 'Ajuste o plano conforme seus resultados e capacidade de produção. Alto engajamento depende de tema, conteúdo, público e distribuição. O Legacy ajuda a organizar e testar; não cria contas automaticamente nem garante crescimento.' }
]

type Progress = { step: number; completed: boolean }
const Context = createContext<{ start(kind: Kind, restart?: boolean): void; progress: Record<Kind, Progress> }>({ start: () => {}, progress: { app: { step: 0, completed: false }, profile: { step: 0, completed: false } } })
const read = (key: string): Progress => { try { const p = JSON.parse(localStorage.getItem(key) ?? 'null'); return p && Number.isInteger(p.step) && p.step >= 0 ? p : { step: 0, completed: false } } catch { return { step: 0, completed: false } } }

export function TutorialProvider({ children, page, navigate }: { children: ReactNode; page: PageKey; navigate(page: PageKey): void }) {
  const { workspace } = useWorkspace()
  const key = (kind: Kind) => `legacy-tutorial:${workspace.id}:${kind}`
  const [progress, setProgress] = useState<Record<Kind, Progress>>(() => ({ app: read(key('app')), profile: read(key('profile')) }))
  const [kind, setKind] = useState<Kind | null>(null)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const steps = kind === 'profile' ? profileSteps : appSteps
  const step = steps[index]
  const persist = (kind: Kind, step: number, completed: boolean) => { const value = { step, completed }; setProgress((p) => ({ ...p, [kind]: value })); try { localStorage.setItem(key(kind), JSON.stringify(value)) } catch { /* The tour also works without persistence. */ } }
  useEffect(() => { setKind(null); setProgress({ app: read(key('app')), profile: read(key('profile')) }) }, [workspace.id])
  useEffect(() => {
    if (!kind || !step) return
    setRect(null)
    if (page !== step.page) { navigate(step.page); return }
    let stopped = false
    let frame = 0
    let attempts = 0
    let target: HTMLElement | null = null
    const measure = () => { if (target && !stopped) setRect(target.getBoundingClientRect()) }
    const find = () => {
      if (stopped) return
      target = document.querySelector<HTMLElement>(step.target)
      if (target) {
        target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' })
        measure()
      } else if (++attempts < 90) frame = requestAnimationFrame(find)
    }
    frame = requestAnimationFrame(find)
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => { stopped = true; cancelAnimationFrame(frame); window.removeEventListener('resize', measure); document.removeEventListener('scroll', measure, true) }
  }, [kind, index, page, workspace.id])
  const start = (next: Kind, restart = false) => { const saved = progress[next]; setIndex(restart || saved.completed ? 0 : Math.min(saved.step, (next === 'app' ? appSteps : profileSteps).length - 1)); setKind(next) }
  const pause = () => { if (kind) persist(kind, index, false); setKind(null) }
  const advance = () => {
    if (!kind) return
    if (index === steps.length - 1) { persist(kind, index, true); setKind(null); navigate('tutorial') }
    else { persist(kind, index + 1, false); setIndex(index + 1) }
  }
  const width = Math.min(380, window.innerWidth - 32)
  const left = rect ? Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)) : (window.innerWidth - width) / 2
  const top = rect ? (rect.bottom + 300 < window.innerHeight ? rect.bottom + 16 : Math.max(16, Math.min(rect.top - 290, window.innerHeight - 320))) : Math.max(16, (window.innerHeight - 300) / 2)
  return <Context.Provider value={{ start, progress }}>{children}
    <Dialog.Root open={Boolean(kind)} onOpenChange={(open) => { if (!open) pause() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-transparent" />
        {rect && <div aria-hidden className="pointer-events-none fixed z-[71] rounded-card border-2 border-fg transition-[top,left,width,height] duration-300" style={{ left: Math.max(0, rect.left - 5), top: Math.max(0, rect.top - 5), width: Math.min(window.innerWidth, rect.width + 10), height: Math.min(window.innerHeight, rect.height + 10), boxShadow: '0 0 0 9999px rgb(0 0 0 / 75%)' }} />}
        {!rect && <div aria-hidden className="pointer-events-none fixed inset-0 z-[71] bg-black/75" />}
        <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => document.querySelector<HTMLElement>('main')?.focus()) }} style={{ left, top, width }} className="fixed z-[72] max-h-[calc(100vh-32px)] overflow-auto rounded-card border border-line-strong bg-panel p-5 shadow-2xl">
          <p className="mb-2 text-xs text-dim">{kind === 'profile' ? 'Guia de perfil' : 'Conheça o Legacy'} · {index + 1} de {steps.length}</p>
          <Dialog.Title className="text-base font-semibold">{step?.title}</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-relaxed text-dim">{step?.body}</Dialog.Description>
          <div className="mt-5 flex flex-wrap items-center gap-2"><Button size="sm" onClick={pause}>Pausar tutorial</Button><div className="ml-auto flex gap-2"><Button size="sm" disabled={index === 0} onClick={() => { if (kind) persist(kind, index - 1, false); setIndex(index - 1) }}>Voltar</Button><Button size="sm" variant="primary" onClick={advance}>{index === steps.length - 1 ? 'Concluir tutorial' : 'Próximo'}</Button></div></div>
          <p className="mt-3 text-[11px] text-dim">Escape pausa. Você pode retomar em Tutoriais.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </Context.Provider>
}
export const useTutorial = () => useContext(Context)
