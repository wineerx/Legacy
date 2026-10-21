# Janelas de pico e distribuição de Containers — PR 06

Entrega no checkout em 2026-10-09, sobre os PRs 01–05, sem commit. Escopo do roadmap: "Janelas de pico configuráveis e distribuição de Containers; evoluir `planSlots`, considerar reservas e janela móvel". O pedido original ilustra: 4 Containers de 12 vídeos a cada 15 min distribuídos em 09:00→11:45, 13:00→15:45, 17:00→19:45 e 21:00→23:45, com "48 / 50 publicações previstas · margem operacional 2", e exige horários configuráveis, sem números mágicos. Ficam para o PR 07: janela planejada × estimativa atual, atraso e propostas de ajuste. Agenda, drag & drop e redistribuição de agendamentos existentes também ficaram fora.

## Auditoria do PR 05 antes de começar

- Backup não destrutivo do trabalho sem commit (patch de 6 MB e 328 arquivos não rastreados) no scratchpad da sessão. Nada foi revertido.
- Código do PR 05 conferido nos pontos descritos (migration 0010, reserva atômica, espera proativa, lacre de receitas, conferência do job, painel). Suíte completa: 644 testes aprovados, 3 opcionais ignorados.
- **Regressão encontrada e corrigida:** o painel de quota consulta a Meta automaticamente ao abrir a revisão. Os E2E `container-drafts` e `container-visual` abrem a revisão com conta sintética e sem cooldown, então faziam GETs reais a `graph.instagram.com`. Agora `LEGACY_PROVIDER_NETWORK=off` recusa localmente qualquer chamada Instagram, antes de abrir socket. O `playwright.config.ts` ativa a trava para todo app lançado. Há teste unitário.
- **Falhas E2E preexistentes e não relacionadas ao PR 05:** `app.spec` (3 testes) e `guest-ui.spec` (1) falhavam no estado sem commit e passavam no HEAD limpo, o que foi conferido em worktrees temporárias, já removidas. A causa são mudanças intencionais de UI que já estavam no checkout, com specs antigos: popover "Primeiros passos" aberto sobre a sidebar após a entrada, bloqueio de IPC até a sessão local ativar, menu por linha na Fila com "Abrir mídia" e item "Sair" no menu da conta. Os specs foram ajustados ao comportamento atual, sem mudar produto.

## Decisões

| Pergunta | Decisão |
|---|---|
| Janelas suportadas | Lista configurável por workspace (até 12): início, fim e dias da semana. Sem janelas embutidas; sem janelas, a distribuição explica que é preciso configurá-las. |
| Fuso | IANA do workspace. Fim anterior ao início atravessa a meia-noite e pertence ao dia em que começa. Horários inexistentes na virada do horário de verão avançam para o próximo minuto válido (mesma regra do `zonedToUtc`). |
| Conflitos | Janelas que se sobrepõem em qualquer dia, inclusive sábado→domingo, são recusadas no editor e no serviço. Fim igual ao início, horário inválido ou dia repetido também. |
| Estratégia | Na ordem selecionada, cada Container entra **inteiro** no primeiro início possível de uma janela: o início dela ou logo após uma reserva dentro dela. A sequência inteira termina antes do fim da janela. Não divide Containers, não muda o intervalo, não comprime nada e só considera publicações em até 90 dias (limite atual do agendamento). |
| Reservas | Cada Container agendado ocupa o intervalo entre seus jobs pendentes, como um bloco sem intercalação. Jobs legados e ambíguos ocupam pontos. Rascunhos já posicionados ocupam horário, mas não são reservas de quota. Cada Container novo mantém o próprio intervalo de distância de tudo isso. Jobs com falha ou cancelados não ocupam horário. |
| Quota | Com leitura válida e atual, cada colocação é testada com a projeção do PR 05 (limite e janela da Meta). Se exceder, tenta o próximo horário. Com quota desconhecida ou desatualizada, distribui sem considerar limite e diz isso (política do PR 05). |
| Planejamento × execução | A distribuição só grava `planned_start_at`/`planned_end_at` e o fuso de **rascunhos**. Não cria jobs nem move agendamentos existentes. Agendar continua sendo uma etapa por Container, com a verificação atômica do PR 05. A fila mantém adiamento, ordem, pausas, retries e checkpoints. |
| Aplicação | Prévia e aplicação são operações separadas. Aplicar recalcula o plano numa transação IMMEDIATE e recusa tudo se algo mudou (outro agendamento, outra distribuição, revisão de um rascunho). Duas prévias da mesma conta não conseguem ocupar o mesmo horário. |
| Migration | Nenhuma: as janelas ficam na tabela `settings` (`scheduler.peakWindows`), já por workspace. |

`planSlots` passou a usar as mesmas ocorrências de janela (`windowOccurrences`), ganhando suporte a janelas que atravessam a meia-noite sem mudar os casos existentes. O fluxo real usa `distributeContainers`, que é a evolução orientada a Containers.

## Interface

- **Configurações → Janelas de pico:** adicionar e remover janelas, início/fim com o seletor de horário existente, dias da semana, aviso de meia-noite e validação de sobreposição antes de salvar. Estados de carregando, erro e vazio.
- **Biblioteca → Containers em rascunho:** caixas de seleção definem a ordem (1º, 2º…). **Distribuir em horários de pico** abre a prévia com data inicial e, para cada Container, início → fim, janela e dia, ou o motivo de não ter horário. A quota aparece como "N / limite publicações previstas na janela de X mais carregada", com barra e margem operacional, ou como capacidade desconhecida. **Aplicar horários aos rascunhos** é explícito e o aviso diz que nenhum job foi criado. [Captura](screens/qa-peak/distribuicao.png).
- **Revisão do Container:** os atalhos de horário passam a ser os inícios das janelas configuradas. Sem janelas, os atalhos anteriores continuam.

## Critérios de aceite

- [x] Janelas configuráveis, persistidas por workspace, validadas no serviço; nenhuma janela ou limite embutido.
- [x] Meia-noite, fusos e horário de verão (salto e retorno) com intervalos em tempo absoluto.
- [x] Exemplo do roadmap reproduzido exatamente, inclusive 48/50 e margem 2.
- [x] Ordem e intervalos preservados; Container não dividido; motivo explícito quando não cabe.
- [x] Reservas existentes nunca movidas; bloco por Container; pausado ocupa, cancelado libera, legado conta.
- [x] Contas isoladas; uma conta por distribuição; Containers agendados não são redistribuídos.
- [x] Quota conhecida molda o plano; desconhecida ou desatualizada não bloqueia nem inventa capacidade.
- [x] Aplicação atômica, com recusa de prévias concorrentes ou desatualizadas; agendamento continua idempotente e passa pela verificação do PR 05.
- [x] Retries, checkpoints, pausas e cancelamentos preservados; snapshots e receitas congelados intocados.

## Validação

- `npm run typecheck` e `npm run build`: aprovados.
- `npm test -- --maxWorkers=2`: 669 testes aprovados em 110 arquivos; 3 benchmarks opt-in ignorados.
- Novos: [peak-windows.test.ts](../src/shared/peak-windows.test.ts) (configuração, ocorrências, meia-noite, horário de verão, distribuição, quota, horizonte), [peak-windows.test.ts](../src/main/services/peak-windows.test.ts) (banco real: configuração por workspace e IPC, exemplo completo até o agendamento, reservas, pausa/cancelamento/legado, contas, concorrência, quota, intercalação, retry/checkpoint), [DistributionPanel.test.tsx](../src/renderer/features/library/DistributionPanel.test.tsx) e o teste da trava de rede.
- Electron E2E [peak-windows.spec.ts](../tests/e2e/peak-windows.spec.ts): janelas digitadas em Configurações, 4 rascunhos distribuídos e aplicados sem jobs, atalhos da revisão e agendamento aceito pela quota. O app real usa relógio real, então o teste verifica a estrutura: janelas, ordem, 2h45 por Container, 48/50.
- 29 E2E aprovados no total: os de PR 01–06 (rascunhos, configuração visual, Templates, pipeline JIT, quota, janelas), Fila, publicação, seletor de horário, `app`, `guest-ui` e primeiros passos. Nenhum faz chamada externa.

## Limitações e pendências

- As janelas valem para o workspace inteiro; janelas por conta não estão no roadmap.
- A distribuição considera apenas a ordem escolhida e o primeiro horário possível; não otimiza nem redistribui. Propostas de ajuste são escopo do PR 07.
- O E2E não fixa horários exatos, porque o app usa relógio real; os horários exatos são cobertos nos testes de integração com relógio controlado.
- UX observada: ao abrir o detalhe de uma tarefa da Fila, o foco vai para "Fechar detalhes" e o tooltip consome o primeiro Esc. Fica registrado, sem alteração neste PR.
