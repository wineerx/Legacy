# PR 04 — Visual Template Builder versionado

Estado: proposta para revisão, sem implementação de produto iniciada.

## Entrega e referências

Construir uma área Templates para criar composições completas, editar visualmente, testar com mídias locais e salvar versões reutilizáveis. O pedido atualizado amplia o PR 04 além de watermark/banner/capa: inclui fundo, formato, identidade, textos, área da mídia e respiros, com prévia individual e grade de nove publicações.

As referências enviadas demonstram três famílias de composição: fundo branco com avatar/identificação e texto acima da mídia; fundo escuro com identidade, texto superior e CTA inferior; identidade e texto alinhados à esquerda, com vídeo centralizado. Controles, contadores, selos e navegação do Instagram são contexto da captura, não elementos a acrescentar automaticamente à composição.

Os estilos solicitados — Meme branco, Meme dark, Texto superior + vídeo, Logo + username, Banner inferior, Full screen e Centralizado — serão configurações editáveis do mesmo modelo. O renderer não terá branches por nome de preset. Exemplos iniciais poderão ser criados e duplicados como Templates comuns; editar ou arquivar um exemplo terá o mesmo comportamento de qualquer outro Template.

## Decisões de arquitetura

Separar identidade do Template, versões imutáveis e configuração aplicada ao Container. Alterações de nome, descrição ou composição geram uma nova versão; arquivar altera a disponibilidade da identidade, preservando o histórico. Duplicar cria outra identidade com versão 1 e conteúdo copiado.

Aplicar uma versão copia a configuração completa para o rascunho. Não cria vínculo de atualização automática. Selecionar uma versão futura exige uma ação explícita, com aviso de substituição se houver ajustes locais. Agendar usa somente o snapshot do Container e o contexto efetivo de cada item; o JIT não consulta Templates.

Alternativas consideradas: referências ao Template atual simplificariam o armazenamento, mas violariam o congelamento; presets de imagens prontas simplificariam a composição, mas perderiam textos dinâmicos e edição de elementos. A proposta usa uma descrição de cena serializável, com imagens incorporadas e geometria validada.

## Modelo persistente

`visual_templates`, por workspace:

- `id`: identidade imutável, gerada pelo serviço.
- `status`: `active` ou `archived`.
- `current_version`: inteiro, começa em 1.
- `revision`: controle de concorrência para edição/arquivo/exclusão.
- `created_at`, `updated_at`: UTC ISO-8601.

`visual_template_versions`, por workspace e identidade:

- `template_id`, `version`: chave única da versão.
- `name`: obrigatório, até 120 caracteres; não precisa ser único.
- `description`: até 2.000 caracteres.
- `visual_snapshot_json`: configuração completa, validada.
- `created_at`: UTC ISO-8601.

Salvamento cria a versão e atualiza a identidade em uma transação IMMEDIATE. Nunca sobrescreve uma versão publicada. `expectedRevision` impede perda de alterações concorrentes. Criação, duplicação e salvamento usam identificadores de requisição persistentes: repetir a mesma intenção após resposta perdida retorna o mesmo resultado; reutilizar a chave com outro conteúdo é recusado.

CRUD inclui exclusão explícita com confirmação de UI, além de arquivo. Excluir remove identidade e versões da área Templates; Containers permanecem válidos porque não dependem desses registros. Não criar FK do snapshot do Container para uma identidade que pode ser excluída. O histórico é preservado ao arquivar, que é a ação normal para retirar um Template de novos usos.

Não alterar `cover_templates`, nem converter capas, lotes ou snapshots legados automaticamente. A migration será aditiva.

## Snapshot da composição

Manter leitura do snapshot `{ version: 1 }` e suas camadas do PR 03. Introduzir snapshot de composição com discriminador `version: 2`, separado do número de versão do Template.

O snapshot v2 contém:

- `source`: identificação informativa opcional `{ templateId, templateVersion, templateName }`.
- `canvas`: largura/altura de referência, formato, fundo e margens/guias.
- `elements`: lista ordenada de elementos com IDs estáveis, tipo, visibilidade, retângulo, opacidade, borda e radius.
- `cover`: configuração de capa, podendo usar imagem incorporada ou frame do vídeo, instante e composição da capa.
- `rendererVersion`: versão do processamento/layout, independente da identidade do Template.

Formatos iniciais: 9:16 (1080×1920), 4:5 (1080×1350), 1:1 (1080×1080) e 16:9 (1920×1080), além de dimensões personalizadas pares entre 320 e 2160 pixels, respeitando teto de 8 megapixels. Esses são formatos do editor; o agendamento continua validando elegibilidade do destino e não promete formatos adicionais de publicação da plataforma.

Coordenadas e dimensões são pixels do canvas de referência. A prévia calcula um fator de escala e converte ações do ponteiro de volta para esse espaço. Mudar formato preserva proporções geométricas por padrão, mostrando as dimensões resultantes. Nenhuma transformação silenciosa em Container agendado.

Tipos de elementos:

- `media`: vídeo de origem ou imagem incorporada, posição, tamanho, `contain`/`cover`, alinhamento de recorte, fundo da área, borda e radius.
- `image`: logo/avatar ou imagem gráfica, bytes PNG incorporados, proporção, posição, opacidade, borda e radius.
- `text`: texto, fonte empacotada, peso, tamanho, altura de linha, alinhamento, cor, largura máxima, posição e padding.
- `watermark`: imagem ou texto, com propriedades de posição/escala/opacidade.
- `banner`: imagem/texto com intervalo temporal explícito, em uma área definida da composição.

Limites iniciais: até 32 elementos, até 4.000 caracteres por bloco, imagens PNG de até 1 MB e até 4.096 pixels por lado, como no PR 03. Não armazenar caminhos temporários, URLs remotas, credenciais ou nomes de fontes arbitrárias no snapshot. Fontes são escolhidas de um catálogo empacotado e versionado; não depender de fontes instaladas pelo usuário. Valores desconhecidos, geometria inválida e conteúdo que exceda limites são recusados pelo serviço, não apenas pelo formulário.

Margens e espaçamentos são editáveis numericamente; guias ajudam posicionamento sem impor um estilo. Elementos podem ficar parcialmente fora do canvas e são recortados no resultado, com aviso visível; dimensões negativas ou nulas são inválidas. Ordenação de camadas é explícita.

## Texto e variáveis

Os blocos permitem texto fixo e as variáveis literais `{{profile_name}}`, `{{username}}`, `{{caption}}` e `{{custom_text}}`. Não executar expressões, HTML ou JavaScript. Substituições são strings, com limites após expansão.

No editor, valores de teste são editáveis e aparecem no preview, sem alterar a mídia da Biblioteca. Ao aplicar ao Container, `profile_name`, `username` e `custom_text` viram contexto local do rascunho, inicialmente preenchido por dados disponíveis do destino; o usuário pode corrigir esses valores. `caption` usa a legenda efetiva do item, respeitando sua sobrescrita.

No agendamento, resolver e persistir o contexto efetivo de cada item. Retry não lê nomes atuais de contas, legendas modificadas ou variáveis do Template. Variáveis desconhecidas são erro de validação; valores ausentes conhecidos produzem aviso e exigem preenchimento ou remoção da variável antes de agendar. Conteúdo Unicode e emoji devem ser testados com a fonte/fallback empacotados.

Quebra automática, métricas de fonte e medidas de linha devem usar o mesmo algoritmo na prévia e no JIT. Não reduzir automaticamente a fonte nem ocultar texto que exceda a área. Exibir aviso de transbordamento e permitir corrigir o bloco.

## Área Templates e editor

Adicionar acesso Templates na navegação existente, sem redesenhar outras áreas. A lista mostra nome, descrição, identidade, versão atual, estado e datas, com busca e filtro de arquivados. Ações: criar, abrir, duplicar, arquivar/desarquivar e excluir. Histórico permite abrir uma versão anterior em leitura e criar uma nova versão a partir dela; nunca edita a anterior.

Editor em duas colunas: propriedades e preview. Cabeçalho com nome, descrição, identidade/versão e **Salvar versão**. Reutilizar controles do PR 03 onde compatíveis e extrair os controles compartilhados necessários. Não duplicar um segundo editor visual para Containers.

Usar componentes existentes do design system e shadcn para Tabs/ToggleGroup, Select, Slider, Popover/color picker, Input, Field, Collapsible, Sheet e confirmação. Cor pode ser editada por picker e campo hexadecimal. Todos os controles têm rótulo, validação, estado de carregamento/erro e foco visível.

Selecionar um elemento no preview abre suas propriedades e destaca seu retângulo. Lista de camadas oferece a mesma seleção por teclado. Arrastar move; alças redimensionam mídia/logo/watermark/banner e caixas de texto. Inputs X/Y/largura/altura mantêm precisão; teclas de direção movem e Shift amplia o passo. A interação não dispara escritas persistentes nem FFmpeg. Adicionar/remover/reordenar elementos e ajustar padding, borda e radius permanecem operações locais até salvar.

Fechar com alterações não salvas exige confirmação. Falha de escrita/conflito mantém a composição local. Leitura de imagens bloqueia salvar até terminar. Double click e resposta perdida não geram versões extras.

## Prévia individual, grade e mídias

**Preview individual** exibe uma composição maior com seleção/arraste e player local quando a mídia é vídeo. **Preview em grade** mostra até nove composições com mídias distintas da Biblioteca; se houver menos, preencher slots vazios com ação para selecionar mídia, sem inventar resultados.

Seleção de mídia de teste é somente leitura, por workspace, com busca/paginação. Não importa, altera ou gera jobs para a mídia escolhida. Imagens incorporadas podem ser usadas como conteúdo/elemento gráfico; isso não introduz publicação de carrosséis ou imagens estáticas na plataforma neste PR.

A grade usa o formato da composição. Pode mostrar uma máscara explicitamente identificada como simulação de recorte para avaliar o perfil; não afirmar que é reprodução garantida do crop aplicado pelo Instagram. Não publicar nem consultar perfis externos para montar a simulação.

Prévia de capa por frame usa reprodução/seek e canvas locais. Não chamar `library.frame` ou FFmpeg durante edição/preview de rascunho. Mudanças de controles refletem imediatamente nos dois modos, sem salvar versões automaticamente.

## Renderer e derivação JIT

Usar um plano de renderização compartilhado, com geometria, clipping, layout do texto e ordenação de camadas. Prévia e rasterização de camadas usam o mesmo renderer Canvas e fontes empacotadas.

Para manter serviços/worker sem imports Electron e evitar dependência de fontes do sistema, a rasterização no JIT será um adapter do main, executado em renderer interno isolado do Electron. O worker pede a rasterização por mensagem interna tipada; serviços recebem essa capacidade por interface. A janela interna é oculta, sandboxed, sem Node, sem credenciais e sem navegação externa. Não depender da janela principal estar aberta.

O adapter recebe apenas o snapshot/contexto congelados e recursos locais validados. Retorna os PNGs de fundo, foreground, máscaras e capa necessários ao plano. Fontes precisam estar carregadas antes de renderizar. A fila limita concorrência e tempo; falha/crash limpa requests pendentes, produz erro recuperável e mantém checkpoints. Fechar a aplicação encerra o adapter. Resultado nunca pode ser escrito no caminho do original.

FFmpeg monta fundo, fonte de mídia redimensionada/recortada, máscara de radius, elementos rasterizados e camadas temporais, preservando áudio e a semântica do frame de capa. Toda ferramenta mantém argumentos em array, sem shell. Arquivos derivados só são criados nessa fase.

Receitas/cache incluem hashes reais do original e recursos incorporados, snapshot/contexto congelados, versão do renderer e manifesto das fontes. Cache hit exige integridade e validação existentes. Limpeza de temporários e recuperação após restart reutilizam o pipeline do PR 03.

Snapshots v1 seguem o caminho atual sem reinterpretar sua posição ou tamanho. A extensão v2 só é ativada explicitamente ao aplicar/construir uma composição.

## Container e overrides

Dentro de **Configuração visual**, acrescentar Select **Template visual**, mostrando nome e versão, e **Editar configuração deste Container**. O Select apresenta identidades ativas; arquivadas não podem ser aplicadas novamente, mesmo se a lista do renderer estiver desatualizada. Um rascunho que já recebeu um Template arquivado continua editável e agendável por conter uma cópia completa.

Aplicação ocorre pelo serviço dentro da mesma transação de `updateDraft`, com revisão e seleção de versão validadas. Não confiar em bytes de versão informados como verdade pelo renderer: buscar a versão solicitada por workspace e copiar seus valores. Ajustes locais posteriores usam `updateDraft`, mantêm a identificação da origem e são marcados como personalizados na UI. Não renomeiam nem alteram o Template.

Uma nova versão do Template não altera nem rascunhos já aplicados nem Containers agendados. Para atualizar um rascunho, selecionar explicitamente a versão desejada, revisar e salvar. Após agendamento, escolha e edição ficam bloqueadas.

Manter precedência dos overrides individuais do PR 03. Edições individuais de banner/capa são consideradas na área da mídia antes da composição externa; versões prontas continuam como fonte, sem reprocessar sua edição anterior. Elementos externos de identidade/texto/layout são aplicados à composição. Não substituir `recipeVersionId` original do item; persistir a receita efetiva no snapshot/job.

## Entregas e arquivos

1. Contratos Zod v2/variáveis, migration de Templates/versões, repository e service transacionais, IPC e testes de concorrência/workspace/idempotência.
2. Modelo de cena e renderer compartilhados, catálogo/fontes empacotadas, testes de geometria/texto/clipping e adapter JIT integrado ao main/supervisor/worker.
3. Área Templates, CRUD/histórico, editor reutilizável, seleção de mídias reais, interações e grade.
4. Select/aplicação/ajustes no Sheet do Container, snapshot/contexto congelados, overrides e cache.
5. Testes reais de FFmpeg, Electron E2E, regressão completa e documentação.

Principais pontos existentes: `src/shared/container-visual.ts`, `src/shared/publication-containers.ts`, `src/shared/ipc-contract.ts`, `src/main/db/schema.ts`, `src/main/db/migrations`, `src/main/services/container-visual.ts`, `src/main/services/versions.ts`, `src/main/media/ops.ts`, `src/main/supervisor.ts`, `src/main/worker/worker.ts`, `src/renderer/features/library/ContainerDraftSheet.tsx`, `ContainerVisualFields.tsx`, `ContainerVisualPreview.tsx`, `src/renderer/App.tsx` e `components/Sidebar.tsx`. Novas unidades ficam em shared/visual-layout, main/services/visual-templates, main/repos/visual-templates, main/visual-renderer e renderer/features/templates, mantendo responsabilidades separadas.

Não iniciar Scheduler quota-aware, novas quotas, calendário, Direct Post TikTok, carrosséis, edição dos originais ou publicação externa.

## Critérios de aceite

- Criar v1; salvar edição gera v2; versão anterior permanece byte a byte intacta. Novo uso recebe v2; um Container existente mantém a versão que recebeu.
- Duplicar gera outra identidade/v1. Arquivar remove de novos usos e preserva snapshots; excluir a origem também não inviabiliza um Container copiado.
- Salvar/aplicar rascunho não executa FFmpeg/FFprobe nem cria jobs/receitas/derivações. Preview individual/grade usa mídia local sem processamento antecipado.
- Conflito de revisão, aplicação de versão de outro workspace, Template arquivado entre listagem e aplicação e payload inválido fazem rollback integral. Repetir intenção não duplica identidades/versões/jobs.
- Aplicar ao Container, ajustar posição/texto e agendar congela composição, imagens, fontes/contexto identificados e receita; alterar/excluir o Template depois não muda resultado.
- Snapshot copiado reproduz a composição sem ler identidade/versão original do Template. Retry/cache/restart preservam a mesma receita e contexto efetivo.
- Overrides individuais permanecem; original mantém hash e bytes. Formato, texto, margens, radius, fit e elementos temporais correspondem ao plano compartilhado.
- Reproduzir as três famílias das referências com configurações do editor, sem código específico por preset.
- Testar Unicode/emoji, texto longo/multilinha, variáveis ausentes/desconhecidas, portrait/landscape, logo com alpha, limites, transbordamento, leitura assíncrona, drag/resize/inputs e nove mídias distintas.
- Testar falha/timeout/restart do adapter com a janela principal fechada, cleanup e leases/checkpoints preservados.
- Antes de concluir: `npm run typecheck`, `npm test -- --maxWorkers=2`, `npm run build` e Electron E2E do builder/Containers/JIT, usando contas sintéticas e agendamentos futuros, sem publicação externa.
