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

## Padrão de filtros (todas as telas)

Fonte: `components/ui/Filters.tsx`, estilos em `styles/patterns.css`. Ordem fixa dentro de um `ds-filter-card`:

1. `FilterBar`: `FilterSearch` → `FacetFilter` (estado, plataforma, tipo; pontos coloridos e contagem) → `FilterPopover` ("Filtros", com contador, seções `FilterSection`, "Redefinir" e "Ver N resultado(s)"). À direita: visualização (`Segmented`) e ações.
2. `FilterPresets`: combinações rápidas que substituem os filtros atuais (ex.: "Precisam atenção", "Falhas aguardando retry", "Virais (100 mil+ views)").
3. `ActiveFilters`: total, chips "Remover filtro: …", "Limpar filtros" ou "Sem filtros aplicados".

Aplicado em Fila, Biblioteca, Perfis, Calendário e Notificações.

## Cards, estados e gráficos

`Card`/`CardHeader` (cabeçalho com divisória), `StatusBadge`/`ToneDot` (tons `green`, `red`, `orange`, `blue`, `purple`, `yellow`; o texto sempre diz o estado), `Segmented`, `ChipGroup`. Gráficos em `components/charts/Charts.tsx` (SVG/CSS, sem dependência): `StatCard`, `DeltaBadge` ("—" sem período anterior), `BarChart`, `LineChart`, `DonutChart`, `PipelineList`, `Meter`, `Sparkline`. Paleta monocromática `--color-chart-1..5`. Todo gráfico tem resumo textual em `aria-label`. Dados vêm de `dashboard.get` → `analytics` (14 dias no fuso do workspace).
