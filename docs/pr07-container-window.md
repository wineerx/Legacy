# Janela do Container, estimativa, atraso e ajustes — PR 07

Entrega no checkout em 2026-10-09, sobre os PRs 01–06, sem commit. Escopo do roadmap: "Janela planejada, estimativa atual, atraso e proposta de ajuste; usuário escolhe alteração de intervalo/estratégia". O pedido original pede início e fim planejados, duração, publicados, restantes, atraso, o aviso "O Container ultrapassará sua janela em N min" e as opções **Manter intervalo**, **Reduzir intervalo** e **Mover restante**, sem nunca alterar a estratégia em silêncio. A spec do PR 01 já reservava `estimatedEndAt`, `delayMin`, `quotaTotal` e `quotaAvailable` e alertava que `run_at` sozinho não é estimativa. Agenda (PR 08) e drag & drop (PR 10) ficaram fora.

## Estimativa

- **Itens já iniciados no remoto** (checkpoint com contêiner, publicação em curso ou mídia) contam como "agora". O `run_at` deles marca polling, não publicação.
- **Itens novos** usam o próprio `run_at`, que já inclui adiamentos de quota e retries, nunca antes de agora. Com leitura de quota válida (PR 05), cada item é colocado no primeiro instante em que a Meta aceitaria, considerando o consumo informado, confirmações locais, operações ambíguas e os outros pendentes da conta. Sem leitura válida, a estimativa diz que não considerou quota.
- **Atraso** = término estimado − fim planejado, arredondado para cima; zero quando dentro da janela.
- **Itens vencidos** são sinalizados: `run_at` passou e o processador ainda não enviou, por exemplo com o app fechado.
- **Pausado:** a estimativa fica suspensa, não inventada. Cancelado e concluído não têm estimativa.
- `containers.get` e `containers.query` passam a preencher os campos reservados. `quotaTotal`/`quotaAvailable` vêm da leitura válida; sem ela, ficam nulos.

## Propostas e aplicação

Só aparecem com atraso, em Container ativo, e só alteram **itens novos**. Itens em envio, ambíguos, confirmados ou com falha nunca mudam.

| Opção | Efeito |
|---|---|
| Manter intervalo | Nenhum horário muda; a decisão fica registrada. |
| Reduzir intervalo | O primeiro restante mantém o horário (ou passa a agora + 1 min); os demais se aproximam do fim planejado, com mínimo de 15 min (o mínimo do produto). Não é oferecida se o intervalo já é 15, se resta um vídeo, ou se o atraso não vem do intervalo (quota, por exemplo). O motivo é mostrado. |
| Mover restante | Usa a distribuição do PR 06: próxima janela de pico livre, mesmo intervalo, sem sobrepor reservas da conta e respeitando a quota conhecida. O fim planejado passa a ser o novo término. Sem janelas configuradas, explica como habilitar. |

A aplicação exige confirmação e é atômica, numa transação IMMEDIATE:

- a proposta é recalculada e precisa coincidir com a revisada (revisão do Container e horários);
- cada job precisa continuar na fila sem checkpoint remoto;
- só `run_at` e o `planned_publish_at` do item mudam; payload, legenda, receita e snapshots congelados ficam intactos;
- a quota da conta é reverificada com a mesma regra do agendamento (PR 05);
- o Container recebe nova revisão, o intervalo (ao reduzir) ou o fim planejado (ao mover).

Migration aditiva `0011_container_adjustments`: tabela `publication_container_adjustments` com o tipo de ajuste e o plano antes e depois (intervalo, fim planejado, atraso e horários). É o registro de que nada mudou em silêncio.

## Interface

No Sheet de Containers da Biblioteca há um seletor **Rascunhos / Agendados**. Os agendados mostram estado ("No prazo", "+N min", "Pausado") e publicados/total. Ao abrir um deles, o painel **Janela do Container** mostra janela planejada, publicados, término estimado, "termina em", barra de progresso, alerta de atraso, vencidos, itens em envio, se a quota foi considerada, as opções disponíveis com o efeito de cada uma (e o motivo das indisponíveis), confirmação em diálogo e o histórico de ajustes. [Captura](screens/qa-window/janela-atrasada.png).

## Critérios de aceite

- [x] Janela planejada, publicados, restantes, término estimado e atraso por Container; campos reservados do PR 01 preenchidos.
- [x] `run_at` de polling não vira estimativa; vencidos e itens em envio identificados.
- [x] Quota conhecida considerada; desconhecida ou desatualizada sinalizada, sem previsão inventada.
- [x] Pausado suspende a estimativa; cancelado e concluído sem propostas.
- [x] Três opções com motivos de indisponibilidade; nada muda sem confirmação.
- [x] Aplicação atômica, revalidada e com nova verificação de quota; só itens novos se movem; outros Containers e reservas nunca mudam.
- [x] Histórico persistido; snapshots, receitas, payloads e checkpoints intactos.

## Validação

- `npm run typecheck` e `npm run build`: aprovados.
- `npm test -- --maxWorkers=2`: 688 testes aprovados em 113 arquivos; 3 benchmarks opt-in ignorados.
- Novos: [container-window.test.ts](../src/shared/container-window.test.ts) (estimativa e propostas), [container-window.test.ts](../src/main/services/container-window.test.ts) (banco real, adiamento real da fila, IPC, aplicação, quota, pausa/cancelamento, Containers vizinhos) e [ContainerWindowPanel.test.tsx](../src/renderer/features/library/ContainerWindowPanel.test.tsx).
- Electron E2E [container-window.spec.ts](../tests/e2e/container-window.spec.ts): atraso simulado como a fila faria, painel, confirmação, redução aplicada só aos jobs pendentes e histórico; nada publicado.
- Suíte E2E completa: 36 aprovados. O `additional-revisions.spec`, ainda não exercitado nesta série, estava desatualizado em relação à Fila em tabela (redesenho anterior aos PRs de Container) e foi adaptado às ações por linha e ao detalhe lateral, mantendo as verificações.

## Limitações

- A estimativa supõe que o processador está ativo. Com o app fechado, os vencidos acumulam e a estimativa se atualiza quando ele volta.
- O adiamento por quota já existente (PR 05) desloca toda a sequência pendente da conta; o painel mostra o efeito, mas não reverte esse deslocamento.
- "Mover restante" considera a próxima janela livre a partir de hoje, sem otimização entre Containers.
