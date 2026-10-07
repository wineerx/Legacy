# Auditoria de sessões, GitHub e versão aberta — 06/10/2026

## Resultado

A versão aberta não representa a união de todos os trabalhos. Há três estados diferentes: instalação local 0.7.1, compilação de revisão do PR #9 e release pública 0.7.0. A revisão usa um banco temporário separado e não mostra os dados/contas/fila da instalação.

Foram inventariados **27 commits alcançáveis por branches remotas**, 10 branches e 9 PRs; também foi comparado o worktree local Legacy-tunel, com **20 commits que não estão nas branches remotas**. Os nomes de coautoria não identificam a sessão com segurança: o CLAUDE.md exige o trailer Claude até nos commits feitos pelo Codex.

Não alterei código, banco, credenciais, janela ou fila durante esta auditoria. Apenas atualizei referências Git e escrevi este relatório. A revisão de funcionamento abaixo é estática/por testes existentes; não fiz publicação real ou scrape pago.

## Estados de entrega

| Estado | Referência | Conteúdo |
| --- | --- | --- |
| Release pública e main | [v0.7.0](https://github.com/wineerx/Legacy/releases/tag/v0.7.0), 573cdbe | Recuperação e acompanhamento da fila; não inclui PRs #8/#9. |
| Instagram local | [PR #8](https://github.com/wineerx/Legacy/pull/8), 02d31b6 | HTTPS temporário/MP4 local para vídeos associados a post remoto; aberto, CI aprovado. |
| Revisões recentes | [PR #9](https://github.com/wineerx/Legacy/pull/9), 577aa57 | Visitante, pausa, shadcn, TikTok/importação, notificações, repostagens, Sidebar e edições; aberto. |
| Instalação local | Legacy.exe, ProductVersion 0.7.1.0 | Executável de 06/10 às 13:54; anterior aos commits de UI ae135d5 e 09efcb4. |
| Janela que abri | Processo 58616, criado às 19:14:54 | Compilação às 17:18, correspondente à revisão funcional de 09efcb4. Não recarreguei esta janela após as últimas mudanças. |
| Arquivos compilados atuais | out/renderer/index.html, às 19:18:27 | Incluem o checkbox compacto; o bundle ainda contém a frase removida às 19:30 no commit 577aa57. |
| Worktree separado | C:/Users/noob7/Desktop/Legacy-tunel, feat/publicacao-tunel, 4e0ca43 | Transporte local também suporta vídeo importado do PC sem post remoto; essa parte não foi portada. |

## Achados que explicam diferenças

1. **Publicação de vídeo só do PC está ausente da revisão aberta.** O commit local 336abf4 remove a exigência de origem remota e 460230f torna post_id opcional no histórico, com migração 0004. No PR #9, ComposePage.tsx ainda bloqueia itens sem postId e scheduleComposition exige um remotePost ligado ao asset. Evidências: ComposePage.tsx:164 e instagram-publishing.ts:109. O PR #8 declara expressamente que importações sem post remoto ficaram fora do ajuste.
2. **Os dois ajustes mais recentes não chegaram à janela aberta.** 6315adb compacta Selecionar todas; 577aa57 remove a frase. A janela foi iniciada antes dos dois commits. A última compilação em disco inclui o primeiro, mas foi produzida antes da remoção da frase. Compilar não substitui o renderer já carregado.
3. **PRs #8 e #9 ainda não foram mesclados e não existe release 0.7.1 no GitHub.** O instalador 0.7.1 é local. Atualizar pelo latest.yml público leva à release 0.7.0, não à revisão de UI.
4. **CI #9 não está totalmente verde.** [Run 37540998502](https://github.com/wineerx/Legacy/actions/runs/37540998502) falhou em additional-revisions.spec.ts:145: medição do badge fora da largura medida da Sidebar (123,14 > 97,36). [Run 37541003270](https://github.com/wineerx/Legacy/actions/runs/37541003270) passou. As medições são coletadas em sequência durante uma transição de largura; a causa pode ser a medição antes de a animação estabilizar. Precisa estabilizar/reproduzir antes de concluir se há overflow real. Testes locais aprovados não substituem esse achado.
5. **O commit remoto 553ed81 não é uma funcionalidade perdida.** É o único commit remoto fora da ancestralidade de HEAD. A comparação 553ed81 → 5dba8e2 mostra diferenças apenas em CHANGELOG, README, docs/publishing-ui e versão do package/lock; o código foi reincorporado na 0.6.1. Reaplicar cegamente a branch antiga reintroduziria o transporte online antigo.

## Pedidos recentes: conferência por código

| Pedido | Situação na branch remota 577aa57 |
| --- | --- |
| Cancelar/passar a vez em falhas | Presente, desde PR #7; ações para queued/failed. |
| Fila com filtros, paginação, detalhes recolhíveis e árvore | Presente. Árvore agrupa os itens da página/lote; não é uma nova fila independente. |
| Identificar vídeo publicado e abrir somente ele na Biblioteca | Presente, por jobId/histórico e asset/SHA; limpar filtro disponível. |
| Confirmação da API em verde | Presente, token text-ok. |
| Permanecer em execução durante preparação externa | Presente no loop com lease/heartbeat e checkpoints; saída terminal após sucesso/erro/timeout explícito. |
| Select Estado shadcn/Radix | Presente no componente compartilhado Select. |
| Alertar repostagem na mesma conta | Presente: histórico, SHA, IDs/permalink, tarefas ativas e duplicatas no lote. Confirmação intencional habilita envio. |
| Remover conteúdos duplicados | Parcial: alerta e acesso à exclusão normal da Biblioteca. Não há uma ferramenta específica de varredura/limpeza de duplicatas. |
| Excluir notificações individuais/múltiplas/todas | Presente, confirmação em massa e isolamento por workspace. |
| Importação incremental sem novas entradas repetidas | Presente na persistência local. O Actor ainda consulta a janela até o limite e o aplicativo deduplica os resultados; não há cursor remoto que busque exclusivamente inéditos. |
| Banner/capa como primeiro frame | Presente, versão editada local e thumb_offset=0, mantendo áudio/resolução. Miniatura final ainda é decisão da plataforma. |
| Importar TikTok | Presente via Actor Apify, perfil/grade/metadados/download separado. Validação por contrato simulado; postagem TikTok segue manual. |
| Ícone de compactar maior | Presente, 18 px, alvo 32 px, tooltip. |
| Mascote com reação e balão •••/Progress | Presente, Radix Popover/Progress com contagens reais; movimento reduzido desativa reação. |
| Logo Instagram em Publicar em | Presente, SVG transparente ao lado dos textos em coluna. |
| Notificações compactadas com badge | Presente em código para 0/99+; CI de layout precisa ser resolvido. |
| Avatar do perfil original sem aumentar altura | Presente, 20 px, Avatar.Image/Fallback; foto depende do campo fornecido pela origem. Perfis já cadastrados sem foto exigem atualização que traga esse dado. |
| Tela de entrada a cada abertura e pausa até entrar | Presente, sessão local em memória; sair pausa novas tarefas e mantém trabalho iniciado. |
| Login de integrações em vez de token Meta | Não implementado como OAuth; plano confirmado era visitante local e mantinha credenciais de integração separadas. |
| Calendários, numéricos −/+ e prévia responsiva | Presentes, componentes compartilhados e layout desktop/móvel. |
| Intervalo só para lote | Presente; um vídeo usa valor interno padrão e validação ignora intervalo oculto. |
| Celebração apenas após confirmação | Presente, reconhecimento persistido por job e agrupamento de sucessos próximos. |
| Selecionar todas compacto/desativado se vazio | Presente em 6315adb; não foi carregado pela janela que permaneceu aberta. |
| Remover apenas a frase solicitada | Presente no código/commit 577aa57, ausente da última compilação em disco. |

## Todos os commits presentes no GitHub

| Commit | Alteração registrada | Inclusão |
| --- | --- | --- |
| [c04d456](https://github.com/wineerx/Legacy/commit/c04d456185a7b3e984acacea3b57793501c714ab) | docs: apresentar Legacy e creditar Eduardo Ximenes | Na branch de revisão |
| [eea6292](https://github.com/wineerx/Legacy/commit/eea6292bb84fe6763965f5e44082537c62f31885) | feat: publicar Legacy 0.2.0 — autoria de Eduardo Ximenes | Na branch de revisão |
| [b896504](https://github.com/wineerx/Legacy/commit/b896504a04eb05aed09215c9b77b982c438e9c2c) | feat: Legacy 0.3 profile discovery, Instagram scheduling, task previews and updates | Na branch de revisão |
| [1dce6f3](https://github.com/wineerx/Legacy/commit/1dce6f34cda6c4fd061b9f3aab7509f008a15620) | docs: normalize README line endings | Na branch de revisão |
| [09a1c7c](https://github.com/wineerx/Legacy/commit/09a1c7c8079a7f19713e3d4b6eb4fc48c653d4a1) | Release Legacy 0.3: profile grid, scheduling and updates | Na branch de revisão |
| [301c78a](https://github.com/wineerx/Legacy/commit/301c78a471561dd063163427c4f2952da4e2c8bb) | fix: play profile and library videos inside Legacy 0.3.1 | Na branch de revisão |
| [f15baf9](https://github.com/wineerx/Legacy/commit/f15baf9078ae209bc6481262e240c77fd1d914e2) | Release Legacy 0.3.1: internal video previews | Na branch de revisão |
| [b9d0090](https://github.com/wineerx/Legacy/commit/b9d0090da4d62d473fce56fa964a8bcb34d483e5) | feat: Legacy 0.4 design system, achievements, publication history and Instagram fixes | Na branch de revisão |
| [3724dee](https://github.com/wineerx/Legacy/commit/3724dee6016a36b2dcfe2b70832dba2386a027a1) | feat: Legacy 0.5 media manager, audio integrity and onboarding | Na branch de revisão |
| [be285af](https://github.com/wineerx/Legacy/commit/be285afc691ee7e0982aba94b066e6bcd6e18ec1) | fix: include audio and media indexes SQL migrations | Na branch de revisão |
| [3b6f9f9](https://github.com/wineerx/Legacy/commit/3b6f9f92e6e0a17c303b52b542dc53048c4762a1) | Merge pull request #4 from wineerx/codex/media-manager | Na branch de revisão |
| [b1bcf4b](https://github.com/wineerx/Legacy/commit/b1bcf4b7db6b338be6b6e3fc957de747d780be9f) | feat: Legacy 0.6 publication destinations and shared scheduling UI | Na branch de revisão |
| [e45fb26](https://github.com/wineerx/Legacy/commit/e45fb268e341a948dd85075c311746d2bb6c806d) | fix: normalize media menu labels and UTF-8 encoding | Na branch de revisão |
| [08cbeee](https://github.com/wineerx/Legacy/commit/08cbeee6e7dce82a75af9f5d2525527343e14229) | Merge pull request #5 from wineerx/codex/publishing-ui | Na branch de revisão |
| [553ed81](https://github.com/wineerx/Legacy/commit/553ed81af8e12c65aaa8f99b4548b310152a0e7d) | fix: refine media previews and protect Instagram publishing transport | Código reincorporado em 5dba8e2; hash separado |
| [5dba8e2](https://github.com/wineerx/Legacy/commit/5dba8e2cfaab8f3830ae263f04cfc42dc11c29fd) | fix: Legacy 0.6.1 media previews and publishing safeguards | Na branch de revisão |
| [0e43cd1](https://github.com/wineerx/Legacy/commit/0e43cd151348bc55ed0a83f0e67b4b0e6f319e44) | test: verify media menu anchoring on either collision-safe side | Na branch de revisão |
| [8f7c88f](https://github.com/wineerx/Legacy/commit/8f7c88fcb3a6d37329430efb308f9c89f0ddd130) | Merge pull request #6 from wineerx/codex/publishing-refinements | Na branch de revisão |
| [4ab5fd9](https://github.com/wineerx/Legacy/commit/4ab5fd974a6709d95f92b8b1bf8600a1bfeb4377) | feat: Legacy 0.7.0 queue recovery and detailed tracking | Na branch de revisão |
| [1494831](https://github.com/wineerx/Legacy/commit/14948311ff9af2f741f658fe68e48576457980f6) | fix: align queue calendar with the suggested future month | Na branch de revisão |
| [573cdbe](https://github.com/wineerx/Legacy/commit/573cdbec9b95864db7df82bd66af927a88f303f1) | Merge pull request #7 from wineerx/codex/queue-operations | Na branch de revisão |
| [7f29ae6](https://github.com/wineerx/Legacy/commit/7f29ae621bb4755823f871741d3519f5e02c8f31) | fix: publish Instagram reels through temporary local media delivery | Na branch de revisão |
| [02d31b6](https://github.com/wineerx/Legacy/commit/02d31b653a8c4a891dbb5b4b700bbb9957bb94a9) | fix: preserve publishing review and media action hit targets | Na branch de revisão |
| [ae135d5](https://github.com/wineerx/Legacy/commit/ae135d5047bfd9e2cc899046663723e0fd3b0bfb) | feat: add local guest entry and refine media workflows | Na branch de revisão |
| [09efcb4](https://github.com/wineerx/Legacy/commit/09efcb41f285bb7641c7b8b02fd20ed9b91190af) | feat: refine publication queue and incremental social imports | Na branch de revisão |
| [6315adb](https://github.com/wineerx/Legacy/commit/6315adb063d38df19d45d22d5621c2c953560e53) | fix: align notification select-all checkbox | Na branch de revisão |
| [577aa57](https://github.com/wineerx/Legacy/commit/577aa5775c4149e9e0bef1792a9c12023938fce6) | fix: shorten profile import helper text | Na branch de revisão |

## Trabalho local da outra sessão que não foi publicado como branch no GitHub

Os hashes abaixo não têm branch remota. Isso não significa que todo o código se perdeu: a comparação confirma que MediaHost, servidor/túnel, cópia remuxada e limpeza temporária foram portados para o PR #8. O suporte a PC sem remotePost e sua migração ficaram de fora. Commits antigos de fundação que aparecem apenas no histórico local também foram consolidados na publicação inicial eea6292; não são automaticamente funcionalidades ausentes.

| Commit local | Alteração | Comparação com revisão |
| --- | --- | --- |
| 2f8d5bb | fix: mostrar subcódigo do status do container Instagram | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 66ecb1f | feat: cloudflared fixado por versão e sha256 | Transporte incorporado no PR #8; sem o hash original no GitHub |
| af11655 | feat: cópia remuxada para publicação sem edit lists | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 94bbf6f | feat: servidor loopback de arquivo único para publicação | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 0787976 | fix: file-share sem vazamento em abort e recusa arquivo vazio | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 04f0be3 | feat: processo cloudflared quick tunnel | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 5f4cfce | fix: túnel ignora api.trycloudflare.com nos logs | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 1114c1e | feat: MediaHost substituível com provedor quick tunnel | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 67d91f7 | fix: registro de exposição robusto e TTL no worker ocioso | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 460230f | feat: histórico de publicação aceita vídeo sem post remoto | Funcionalidade não incorporada: vídeo sem post remoto |
| db7930c | feat: publicar Reels pelo arquivo local via MediaHost | Parcial: host local incorporado; vídeo do PC sem post remoto ausente |
| 336abf4 | feat: Criar postagem aceita vídeo só local para Instagram | Funcionalidade não incorporada: vídeo sem post remoto |
| 57029fc | fix: Perfis exige vídeo baixado para programar | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 065a0fe | fix: remover aviso de link expirável do modal de agendamento | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 8f47425 | docs: Legacy 0.7.0 publicação via túnel | Documentação local; docs remotas descrevem escopo mais limitado |
| d7e2ab1 | fix: liberar túnel e cópia ao parar o worker e varrer tmp/publish no início | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 02e635f | fix: aquecer DNS do túnel antes de sondar a URL | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 6df3680 | test: payload da 0.6 publica pelo host e migração 0004 preserva histórico | Parcial: compatibilidade antiga testada; migração 0004 ausente |
| 62ffc44 | fix: falha de remux definitiva e hash do cloudflared só fixo | Transporte incorporado no PR #8; sem o hash original no GitHub |
| 4e0ca43 | docs: ciclo de vida da cópia, Range, config.yml e nota de atualização da 0.7.0 | Documentação local; docs remotas descrevem escopo mais limitado |

## Consolidação necessária

- Incorporar o fluxo local sem remotePost, incluindo a migração/histórico, preservando visitante, pausa, repostagem e versões editadas do PR #9. Não substituir arquivos pela branch antiga inteira.
- Resolver a validação CI do badge, distinguindo corrida de medição de overflow verdadeiro.
- Definir se a remoção de duplicatas deve virar uma ferramenta própria, além da exclusão disponível na Biblioteca.
- Compilar uma revisão única a partir do commit final e identificá-la por SHA, não só pelo número 0.7.1.
- Abrir a compilação consolidada em dados isolados para revisão; sua fila original não precisa ser tocada.
- Mesclagem/publicação de release não foram executadas por esta auditoria.

## Consolidação posterior autorizada

A revisão 0.7.2 incorpora seletivamente o agendamento/publicador de vídeo do PC, histórico com post remoto opcional e migração 0004 do worktree, preservando a arquitetura e os checkpoints mais recentes. Corrige também a versão fixa do preload, embute commit/data na compilação e aguarda a largura compactada da Sidebar antes de medir o badge; as medidas são capturadas juntas.

A remoção de duplicados permanece pela seleção e exclusão confirmada da Biblioteca, que protege arquivos usados por tarefas. Não foi adicionada exclusão automática. A importação continua deduplicando os resultados reais do provedor; não promete cursor remoto que o Actor não disponibiliza. TikTok permanece manual e integrações não são substituídas por OAuth.

Validação da consolidação: typecheck, 426 testes em 78 arquivos e 23 E2E no Electron. Testes novos cobrem publicação de PC, idempotência, histórico sem origem, filtro exato da Biblioteca, migração com linhas antigas e limpeza protegida por outra publicação local. API Instagram simulada e nenhuma busca paga.

Instalação autorizada separadamente pelo usuário. Backup consistente do banco original contém 36 tarefas na fila, 440 concluídas, 43 canceladas e nenhuma em execução. O SHA definitivo e os checksums do instalador ficam no manifesto externo da compilação, produzido depois do commit final. Esta consolidação não mescla PRs nem publica release.

## União das alterações posteriores — 0.7.3

Após o pedido de reunir todas as atualizações, a revisão incorpora Sonner, calendário compacto, avatares maiores no cabeçalho, escolhas Posts/Reels/Marcados com preferência persistida, consulta opcional da foto da conta com checkpoint, checklist e menu de perfil simplificado. O seletor de workspace foi realocado para Configurações para preservar a função; Instagram continua desconectável em Contas.

O [schema oficial do Instagram Scraper](https://apify.com/apify/instagram-scraper/input-schema) confirma resultsType posts/reels/mentions/details. Marcados usa mentions; a foto usa details para não confundir o perfil importado com o autor de um post marcado. A consulta da foto pode consumir uma execução adicional do provedor quando não houver imagem local válida; erros dessa consulta preservam os posts importados. Nenhuma busca paga foi executada na validação.

Testes de regressão foram atualizados para identificar o toast Sonner sem confundi-lo com o alerta do diálogo e para o novo formato do mês. Typecheck e 443 testes em 79 arquivos passaram. A compilação final é produzida de um checkout isolado do commit consolidado, evitando incluir edições concorrentes depois do commit.

A validação de integração reforçou a pausa com confirmação explícita do worker antes do retorno à entrada e proteção contra uma entrada atrasada após sair. O mascote combina visibilidade do documento com eventos show/hide/minimize/restore do Electron. Os 23 E2E verificam navegação, pausa, progresso, celebração e responsividade; a expectativa do menu acompanha a realocação do seletor para Configurações.

## Alterações locais posteriores — 0.7.4

A revisão incorpora a origem Todos (Posts/Reels/Marcados), seletor por ícones com ToggleGroup Radix, atualização manual de identidade/métricas sem importação de posts, organização dos cards de Contas e alinhamento dos destinos na composição. Threads aparece somente como opção indisponível; TikTok continua manual.

Todos consulta três fontes distintas da Apify, com limite total e deduplicação. Cada fonte conserva seu checkpoint; tentativas subsequentes consultam a execução existente. A atualização de métricas também persiste o runId e protege criações sem confirmação para não repetir uma execução paga após falha de rede. A interface explica as três consultas ao selecionar Todos.

Typecheck, 452 testes em 80 arquivos e 23 E2E passaram, incluindo respostas desconhecidas, falha no dataset e o novo seletor de origem. A compilação fica identificada pelo commit definitivo e a reinstalação preserva o banco. Nenhuma busca paga nem publicação real foi iniciada pela validação.
