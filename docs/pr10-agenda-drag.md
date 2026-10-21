# Drag & drop na Agenda com prévia de impacto — PR 10

Entrega em 2026-10-21, sobre os PRs 01–09. Escopo do roadmap: "Drag & drop com preview de impacto e confirmação; mesmas validações no backend e revisão otimista".

## Comportamento

- **Dia e Semana:** arrastar um Container agendado para outro horário ou dia. O alvo encaixa em passos de 15 min; uma sombra tracejada mostra o novo início e fim durante o arraste.
- **Mês:** arrastar para outro dia mantém o horário do dia.
- **Teclado:** com o bloco em foco, Alt + ↑/↓ move 15 min e Alt + ←/→ move um dia, abrindo a mesma confirmação.
- Um clique sem movimento continua abrindo o Sheet do PR 09. Esc cancela o arraste.
- **Não arrastáveis:** rascunhos, pausados, concluídos e cancelados. O motivo aparece no tooltip do bloco.
- Timeline fica sem arraste nesta entrega.

## Regra do deslocamento

Mover é deslocar a janela planejada inteira pelo mesmo delta. O início e o fim planejados do Container são deslocados juntos.

- Só os **itens novos** se movem: ainda na fila, sem checkpoint remoto e sem confirmação.
- Cada item novo parte de `planned_publish_at` + delta e mantém a forma do plano, inclusive intervalos. Um `run_at` que a quota já adiou não é usado como referência.
- Em seguida os horários passam pela mesma colocação por quota do PR 05/07.
- Itens publicados, em envio ou com falha **nunca mudam**.
- Legenda, mídia, receita e snapshots ficam intactos.

## Prévia de impacto (`containers.drag.preview`, somente leitura)

A prévia mostra:

- antes e depois do início e do fim planejados, e o delta;
- quantos vídeos serão reagendados e quantos ficam como estão (publicados, em envio, com falha);
- a tabela antes → depois de cada vídeo;
- os alertas:
  - vídeos que a quota empurra para depois do plano;
  - atraso em relação à nova janela;
  - sobreposição com outra programação da mesma conta (`occupied` do PR 06);
  - horário fora das janelas de pico configuradas;
  - quota sem leitura válida.

Bloqueios com motivo, que impedem confirmar:

- horário no passado;
- nenhum deslocamento;
- rascunho;
- Container pausado ou cancelado;
- nada restante a enviar.

## Aplicação (`containers.drag.apply`)

Usa as mesmas garantias dos ajustes do PR 07, numa transação IMMEDIATE:

- a prévia é recalculada e precisa coincidir com a confirmada (revisão do Container e horários de cada job);
- cada job precisa continuar na fila sem checkpoint remoto;
- a quota da conta é reverificada (`assertScheduleQuota`);
- o Container recebe nova revisão. Repetir a mesma confirmação falha com "O Container mudou";
- o ajuste é registrado em `publication_container_adjustments` com `kind = 'drag'`, antes e depois (início, fim, atraso e horários). Ele aparece no histórico do painel de janela como "Movido no Calendário".

Não há migration: `kind` já é texto livre na tabela; só o enum TypeScript ganhou `drag`.

## Critérios de aceite

- [x] Arrastar em Dia, Semana e Mês, com encaixe de 15 min e sombra do alvo; alternativa por teclado.
- [x] Prévia de impacto antes de qualquer mudança; cancelar não altera nada.
- [x] Backend revalida tudo na aplicação; revisão otimista impede confirmar uma prévia antiga.
- [x] Só itens novos se movem; outros Containers e reservas da conta não mudam.
- [x] Registro auditável do movimento.

## Validação

- `npm run typecheck`: aprovado.
- `npm test`: 721 aprovados, 3 benchmarks opt-in ignorados.
- Novos testes unitários:
  - [container-drag.test.ts](../src/shared/container-drag.test.ts): deslocamento, forma do plano, itens intocados, bloqueios, quota, conflitos, janelas de pico e encaixe;
  - [container-window.test.ts](../src/main/services/container-window.test.ts): banco real, aplicação atômica, revisão, checkpoint escrito depois da prévia, pausado e isolamento por workspace via IPC;
  - [CalendarPage.test.tsx](../src/renderer/features/calendar/CalendarPage.test.tsx): Alt + seta, prévia, confirmação e bloqueio.
- Electron E2E [calendar-drag.spec.ts](../tests/e2e/calendar-drag.spec.ts) com mouse real:
  - o rascunho não arrasta;
  - a sombra aparece durante o arraste;
  - a prévia de +2 h não muda nada; cancelar também não;
  - confirmar desloca os 12 jobs em exatamente 2 h;
  - o teclado abre a mesma confirmação;
  - o histórico registra o movimento.
  - Estável em três execuções seguidas.
- Suíte E2E completa (39 testes): três falhas, depois corrigidas. Os arquivos afetados foram reexecutados: 20 aprovados.
  - Duas vinham do redesenho de filtros anterior: o seletor de "Filtros avançados" em `app.spec` e o nome duplicado do grupo "Prioridade" na Fila, renomeado para "Escolher prioridade".
  - Uma era anterior a esta série: `brand.spec` ainda procurava o SVG do mascote, que agora é desenhado em canvas.
- Capturas: [prévia](screens/qa-calendar/arrastar-impacto.png) e [aplicado](screens/qa-calendar/arrastar-aplicado.png).

## Limitações

- Sem arraste na Timeline nem redimensionamento (mudar duração ou intervalo continua no painel de janela do PR 07).
- Os conflitos são avisados, não impedidos: a quota é a única regra que bloqueia, como no agendamento.
- Nenhuma publicação real foi feita; a quota nos testes é simulada.
