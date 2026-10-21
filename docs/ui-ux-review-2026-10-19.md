# Revisão de UI/UX — 2026-10-19

Método: capturas de todas as telas com dados sintéticos realistas (perfil e banco isolados, [ui-audit.spec.ts](../tests/e2e/ui-audit.spec.ts)), crítica com a skill `design:design-critique` e auditoria WCAG 2.1 AA com `design:accessibility-review`. O contraste foi calculado com a fórmula WCAG sobre os tokens reais. As referências de design enviadas (cards de boas-vindas, uso de plano, painel de filtros, tabela de chaves, seletor de contas) foram aplicadas onde correspondem a dados reais do Legacy; números de demonstração não foram copiados.

## Achados e correções

| # | Achado | Severidade | Correção |
|---|---|---|---|
| 1 | Ao abrir qualquer Sheet, o foco ia para o "X", cujo tooltip cobria o cabeçalho; o primeiro Esc só fechava o tooltip | 🔴 | O foco vai para o painel (`Sheet.onOpenAutoFocus`); um Esc fecha. Verificado no E2E de auditoria |
| 2 | Desconectar uma conta secundária não pedia confirmação | 🔴 | Todas as contas confirmam antes de desconectar (teste) |
| 3 | Borda de campos com ~1,6:1 contra o fundo (WCAG 1.4.11 exige 3:1) | 🟡 | Token `--color-control-border` `#6b6b6b` (3,40:1 no painel, 3,69:1 no fundo) |
| 4 | `--color-mute` 4,38:1 sobre `raised` (1.4.3) | 🟡 | `#929292` (4,86:1) |
| 5 | Seletor de conta com `role="option"` contendo botão (4.1.2) | 🟡 | Lista de botões com `aria-current` e nomes acessíveis; abre com Enter, fecha com Esc e devolve o foco |
| 6 | Biblioteca: três linhas de controles e ações desabilitadas de baixo contraste sempre visíveis | 🟡 | Ordenação e seleção numa linha; barra "Ações da seleção" só com seleção, com contagem; "Containers em rascunho" no cabeçalho |
| 7 | Atividade recente repetia "Publicar reel em @conta" sem diferenciar itens | 🟡 | Vídeo em destaque, ação secundária, horário e estado |
| 8 | Visão geral sem próximo passo concreto | 🟡 | Card "Olá, @conta" com o próximo Container e ações; card de quota com uso, barra, janela e horário da consulta (sem número inventado) |
| 9 | Contas: conta padrão e demais em blocos diferentes, sem quota nem conta ativa | 🟢 | Tabela única: conta (ativa), plataforma, verificada em, quota, status e ações (tornar ativa, verificar, gerenciar, desconectar) |
| 10 | "1 selecionados" | 🟢 | Concordância corrigida |
| 11 | Avatar "36" para @365spiders | 🟢 | Inicial pela primeira letra |

## Qualidade dos testes

- `app.spec.ts` rodava sem perfil Chromium isolado: dependia do perfil padrão e falhava quando um Legacy estava aberto. Agora usa perfil próprio.
- `diagnostics-performance.spec.ts` dependia do nome de um chunk interno do build; agora procura a exportação em qualquer chunk.
- `brand.spec.ts` atualizado para a nova saudação; a interação do mascote (olhar seguindo o cursor) foi preservada.

## Validação

`npm run typecheck`, `npm run build`, `npm test -- --maxWorkers=2` (709 aprovados, 3 opt-in ignorados) e Electron E2E completo (38 aprovados, incluindo a auditoria de UI com verificações de teclado).

## Pendências observadas

- O popover "Primeiros passos" abre sobre a sidebar após a entrada e pode cobrir links do menu em janelas baixas. Sugestão: abrir ao lado da sidebar ou só por ação do usuário.
- Filtros da Biblioteca: aplicar a hierarquia da referência de painel (cabeçalho com "Limpar", grupos com chips), mantendo os filtros atuais.
- Fila: as colunas "Tipo / Plataforma" repetem "Publicação Instagram / Instagram"; pode virar um único rótulo.
- Não houve teste com leitor de tela real (NVDA); a auditoria cobre semântica, teclado e contraste.
