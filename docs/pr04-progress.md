# PR 04 — ledger

Spec e execução direta aprovadas.

Tasks 1–6: concluídas. Entrega, decisões técnicas e validação em [pr04-visual-templates.md](pr04-visual-templates.md).

Fechamento (sessão retomada do Codex):
- Adapter de rasterização: timeout por pedido, descarte em crash/travamento/falha de carga, recuperação com janela nova.
- FFmpeg: offsets de mídia limitados à caixa (o FFmpeg recentralizava em silêncio quando o arredondamento passava 1 px).
- Busca de Templates com `ESCAPE` explícito; `RENDERER_VERSION` na chave de cache.
- Origem do Template verificada na transação de create/updateDraft; `username` do destino preenchido ao aplicar.
- Editor: avisos de recorte e variáveis vazias, grade sem repetição de mídias, leitura de PNG bloqueia salvar.
