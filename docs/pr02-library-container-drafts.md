# Biblioteca em massa e Containers em rascunho — PR 02

Data: 2026-10-09. Implementação no checkout, sobre a [fundação do PR 01](pr01-containers.md). Não altera a instalação nem publica conteúdo externo.

## Fluxo entregue

Na Biblioteca, selecionar vídeos individualmente ou com **Selecionar página**. A seleção acumula entre páginas. **Selecionar Top N** substitui a seleção pelos primeiros N resultados dos filtros e da ordenação atuais, desde o primeiro resultado, sem mover a página exibida. Aceita de 1 a 1.000; seleciona os disponíveis quando há menos resultados. Trocar filtros continua limpando a seleção, conforme o comportamento anterior.

**Criar novo Container** abre um Sheet com os selecionados. **Adicionar ao Container** permite escolher um rascunho existente; acrescenta vídeos ao final, ignorando os já presentes e informando quantos foram acrescentados/ignorados. **Containers em rascunho** permite reabrir e editar sem precisar selecionar vídeos. A lista de rascunhos é paginada.

O editor permite alterar nome e destino Instagram, visualizar o arquivo local, arrastar pela alça, subir/descer com botões acessíveis e remover itens. O destino pode ficar para depois, como previsto no PR 01. Há uma única conta/plataforma por Container; instalações com apenas a conta padrão também são atendidas. A reprodução usa `grid.query` e `legacy-media`; não chama `library.frame`, `library.details`, FFmpeg ou FFprobe.

**Revisar rascunho** mostra nome, destino e ordem com edição bloqueada. **Salvar rascunho** confirma a escrita. Seleção, filtros e página da Biblioteca permanecem ao fechar. Fechar com alterações não salvas pede confirmação de descarte. O agendamento continua separado: esta entrega não acrescenta uma ação de agendar no editor.

## Contratos e integridade

- Nenhuma migration, entidade ou canal IPC novo. Usa `containers.create`, `containers.query`, `containers.get` e `containers.updateDraft` do PR 01.
- `updateDraft` continua a operação integral e atômica do serviço existente. O renderer carrega todas as páginas antes de editar; rejeita leituras com revisões/totais divergentes. Não substitui o lote por uma página parcial.
- Preserva fuso, início planejado, intervalo, legenda base, snapshot visual, origem do post, receita JIT, sobrescritas e opções individuais. Acrescentar vídeos não altera essas configurações dos itens existentes.
- Envia `expectedRevision`; conflitos preservam mudanças locais e exigem reabrir/revisar, sem sobrescrever silenciosamente. Se o lote for agendado/cancelado durante a edição, o serviço recusa a escrita e o painel bloqueia novas confirmações após ler esse estado.
- Criação mantém o mesmo `requestId` ao repetir o mesmo conteúdo após erro. A ação em andamento bloqueia chamadas simultâneas. Para resposta perdida de atualização, lê e compara a configuração integral antes de considerar a operação concluída, sem repetir a escrita.
- Rascunhos não geram jobs nem processamento. Gates, checkpoints, leases e quota permanecem nos serviços existentes. Não converte lotes legados.

## Componentes e arquivos

Reutiliza Button, Input, Select, Sheet, Modal, Badge, Spinner e EmptyState do design system atual. A composição Field foi adaptada do [shadcn](https://ui.shadcn.com/docs/components/radix/field), mantendo tokens locais e controles rotulados. Select recebe um container de portal opcional e agrupa opções; o editor mantém o portal dentro do Sheet para evitar conflito de foco entre versões instaladas de Radix. Outros consumidores continuam usando o portal padrão.

- `src/renderer/features/library/LibraryPage.tsx`: ações, Top N e cache de mídia selecionada entre páginas.
- `src/renderer/features/library/ContainerDraftSheet.tsx`: escolha, edição, prévia e revisão.
- `src/renderer/features/library/container-draft.ts`: paginação integral, mesclagem, reordenação e payload.
- `src/renderer/components/ui/Field.tsx`, `Select.tsx`, `Sheet.tsx`: composição e integração do painel.
- `src/renderer/lib/selection.ts`: contador sem a indicação incorreta de seleção apenas na página atual.

## Validação

`npm run typecheck` e `npm run build`: aprovados.

`npm test -- --maxWorkers=2`: **574 testes aprovados**, 3 benchmarks opt-in ignorados, 95 arquivos aprovados. Após ajustes finais, a regressão direcionada de Biblioteca, editor, helpers, seleção e serviço de Containers passou com **56 testes em 5 arquivos**.

Testes novos cobrem reordenação sem mutação, deduplicação, limite de 1.000, preservação de receitas/origem/opções, leitura de 205 itens, revisão alterada entre páginas, Top N com filtros/ordenação, revisão/criação, prévia sem processamento, respostas perdidas, concorrência com agendamento, paginação e descarte. O serviço PR 01 continua cobrindo rollback, workspace e bloqueio após agendamento.

`npx playwright test tests/e2e/container-drafts.spec.ts tests/e2e/pipeline-jit.spec.ts`: **2 Electron E2E aprovados**. Banco/perfil temporários, conta sintética e fixture gerada antes do fluxo. Sem publicação externa.

O E2E novo verifica seleção de página/Top N sem mudar página/filtro, destino, prévia, drag & drop, remoção, duplo clique, adição sem duplicação, reabertura/renomeação/limpeza de destino e edição de **205 → 204 itens**. Ao final, **zero jobs**. [Screenshot da revisão](screens/qa-containers/revisao-rascunho.png).

PR 03, watermark, templates, planejamento de horários e redesign da Agenda permanecem fora desta entrega.
