# Calendário centrado em Containers — PR 08

Entrega no checkout em 2026-10-09, sobre os PRs 01–07, sem commit. O pedido original: o calendário deve mostrar **Containers, não dezenas de jobs isolados**, com bloco "Instagram · nome, N publicações, 13:00 → 15:45, progresso 7/12", visual consistente com shadcn e visões Dia, Semana, Mês e Timeline. O Calendário era um placeholder ("em breve"). O Sheet de detalhes (PR 09) e o arrastar (PR 10) ficaram fora.

## Comportamento

- **Fonte:** `agenda.range` devolve, para um intervalo de até 62 dias, os Containers cuja janela planejada toca o período: agendados, em andamento, pausados, concluídos e **rascunhos já posicionados** (tracejados, ex.: distribuídos pelo PR 06). Cancelados e rascunhos sem horário não aparecem. Cada entrada traz o @ da conta, contagens, estado e a estimativa e o atraso do PR 07. A leitura é limitada a 500 Containers por período e avisa quando corta.
- **Fuso:** IANA do workspace. Os limites de cada dia são as meias-noites locais, então dias com mudança de horário têm 23 ou 25 h e os blocos ficam na posição real. Um Container que atravessa a meia-noite aparece recortado nos dois dias.
- **Semana e Dia:** grade de 24 h; bloco do início ao fim planejados; Containers sobrepostos dividem a largura em faixas; blocos curtos têm altura mínima visual sem alterar horários. A grade abre perto do primeiro Container do período.
- **Mês:** grade de 6 semanas (domingo primeiro, como o seletor de data); até 3 Containers por dia e "+N".
- **Timeline:** uma linha por Container na semana, com barra do início ao fim; atrasados em destaque, rascunhos tracejados.
- **Navegação:** anterior, hoje e próximo pela unidade da visão; filtro por conta; estados de carregando, erro com nova tentativa, vazio e período cortado.

Nenhuma migration. Nada é alterado pela tela.

## Critérios de aceite

- [x] Um bloco por Container, com destino, tamanho, janela, progresso, estado e atraso.
- [x] Dia, Semana, Mês e Timeline, com navegação e filtro por conta.
- [x] Fuso do workspace, horário de verão e meia-noite corretos.
- [x] Rascunhos posicionados diferenciados; cancelados ocultos.
- [x] Consulta limitada e com escopo por workspace; intervalo validado no IPC.

## Validação

- `npm run typecheck`, `npm run build`: aprovados. `npm test -- --maxWorkers=2`: 699 aprovados; 3 benchmarks opt-in ignorados.
- Novos: [agenda.test.ts](../src/shared/agenda.test.ts) (intervalos, horário de verão, meia-noite, faixas), [agenda.test.ts](../src/main/services/agenda.test.ts) (banco real), [CalendarPage.test.tsx](../src/renderer/features/calendar/CalendarPage.test.tsx).
- Electron E2E [calendar.spec.ts](../tests/e2e/calendar.spec.ts): 12 jobs aparecem como um único Container nas quatro visões, com rascunho tracejado. Suíte E2E completa: 37 aprovados. Capturas: [dia](screens/qa-calendar/dia.png), [semana](screens/qa-calendar/semana.png), [mês](screens/qa-calendar/mes.png), [timeline](screens/qa-calendar/timeline.png).

## Limitações

- Nos dias de mudança de horário, os rótulos de hora seguem 24 linhas fixas, enquanto os blocos usam a duração real do dia; a diferença é de até uma hora nesses dois dias do ano.
- Os blocos ainda não abrem detalhes; isso é o PR 09.
