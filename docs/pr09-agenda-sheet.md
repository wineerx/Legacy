# Sheet de detalhes da Agenda — PR 09

Entrega no checkout em 2026-10-13, sobre os PRs 01–08, sem commit. Pedido original: ao clicar num Container do Calendário, abrir um Sheet (shadcn) com nome, @ da conta, plataforma, progresso "7 / 12", início e fim, e as ações **Editar**, **Pausar** e **Reagendar**. Roadmap: "Sheet com conta, itens, progresso, janela e ações; totais integrais e lista paginada". O arrastar com prévia de impacto (PR 10) ficou fora.

## Comportamento

- Cada bloco do Calendário (Dia, Semana, Mês, Timeline) é um botão ("Abrir …") que abre o Sheet.
- **Totais integrais:** progresso e contagens (na fila, enviando, com falha, cancelados, aguardando quota) vêm do agregado do Container inteiro, não da página. A lista de vídeos é paginada (20 por página), com posição, horário planejado e estado.
- **Janela:** início, fim, intervalo e término estimado (PR 07), estado e atraso.
- **Editar:** só para rascunhos; abre o editor existente direto naquele rascunho, sem sair do Calendário (`DraftSheetRequest.containerId`). Containers agendados continuam congelados.
- **Pausar e Retomar:** usam os controles do PR 01 com a revisão do Container; pausa impede envios novos e mantém a reconciliação dos já iniciados.
- **Reagendar:** abre o painel de janela do PR 07 no próprio Sheet; qualquer mudança passa pelas propostas confirmadas e auditadas.
- Concluídos e cancelados não têm ações de agenda.

Nenhuma migration nem canal IPC novo: o Sheet usa `containers.get`, `containers.pause`/`resume` e `containers.window.*`.

## Critérios de aceite

- [x] Sheet com conta, plataforma, progresso integral, janela e itens paginados.
- [x] Editar (rascunho), Pausar/Retomar e Reagendar com as regras existentes; nada muda sem ação explícita.
- [x] Abre a partir de todas as visões do Calendário.

## Validação

- `npm run typecheck`, `npm run build`: aprovados. `npm test -- --maxWorkers=2`: 702 aprovados; 3 benchmarks opt-in ignorados.
- Novo: [AgendaSheet.test.tsx](../src/renderer/features/calendar/AgendaSheet.test.tsx) (totais × página, paginação, pausar/retomar com revisão, reagendar, editar só em rascunho, concluído sem ações).
- Electron E2E [calendar.spec.ts](../tests/e2e/calendar.spec.ts) estendido: abrir Container, totais, pausar e retomar conferidos no backend, Reagendar, abrir e editar rascunho a partir do Calendário. Suíte E2E completa: 37 aprovados. [Captura](screens/qa-calendar/detalhes.png).
