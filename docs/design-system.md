# Design system

Fonte da verdade dos tokens: `src/renderer/styles/tokens.css`. Referências visuais: `docs/references/ui-*.png` e `perfil-alvo-*.webp`. Capturas atuais: `docs/screens/`.

## Tokens

| Token | Valor | Uso |
|---|---|---|
| `--color-app` | `#0b0b0b` | fundo |
| `--color-panel` | `#161616` | painéis, cards |
| `--color-side` | `#1a1a1a` | lateral |
| `--color-raised` | `#262626` | elevado, hover |
| `--color-line` | `#3a3a3a` | bordas (ajustado na Task 15; a spec dizia `#2e2e2e`) |
| `--color-line-strong` | `#4a4a4a` | bordas de controles |
| `--color-fg` | `#ededed` | texto |
| `--color-dim` | `#9a9a9a` | texto secundário |
| `--color-mute` | `#8a8a8a` | texto terciário |
| `--color-danger` / `-fg` | `#a04444` / `#f2c9c9` | erro |
| `--color-ok`, `--color-warn` | `#4f9d69`, `#c9a24a` | estados |
| `--radius-ctl` / `--radius-card` | 8 px / 12 px | raios |
| Fonte | Inter Variable, 12/13/14 px | |

Borda, `mute` e `line-strong` foram clareados em relação à spec para atingir contraste mínimo em elementos não textuais (a spec permite aproximações).

## Componentes (`src/renderer/components`)

`Button` (primary, secondary, ghost, danger; `disabledReason` mostra o motivo em tooltip no hover e no foco), `Input`, `Modal` (foco preso, Esc), `Pills`, `Toggle`, `SettingRow`, `EmptyState`, `Toast`, `Tooltip`, `Skeleton`, `MediaCard916`, `MediaGrid`, `Sidebar`, `StatusBar`. `cx` usa tailwind-merge.

Estados obrigatórios: foco visível, desabilitado com motivo, carregando (Skeleton), vazio (EmptyState com próxima ação), erro (toast `role=alert` que persiste até fechar; info com pausa no hover e botão Fechar).

`MediaCard916`: miniatura 9:16; métricas com `role="img"` e `aria-label` ("Visualizações: indisponível"); "—" focável com tooltip; ações no hover e no foco.

## Regras de texto

pt-BR, sentence case, sem "por favor", sem "com sucesso", sem exclamação. Itens indisponíveis aparecem com "em breve" e o motivo. Métrica ausente: "—", nunca zero.
