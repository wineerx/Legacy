# Baseline de performance

Capturada antes de alterações de produção. Harness reproduzível: `src/main/audit/pipeline-benchmark.test.ts`, habilitado por LEGACY_BENCHMARK=before. Dados brutos em docs/benchmarks/before.json.

Ensaios SQLite em arquivo temporário WAL: 1/10/25/40/50/100/200 jobs, distribuição por 1/3/5/10 contas simuladas; enqueue, claim, complete, lag e percentis. Contas simuladas não provam suporte multi-account de produção. Worker com provider simulado permite separar espera externa e processamento interno. FFmpeg real: fixture sintética 360x640, 4 s com áudio, capa; concorrência 1/2/4/8. Não é substituto de vídeos de produção longos/1080p/VFR.

CPU/RSS/event-loop do harness são medidos; a amostragem Windows dos filhos FFmpeg foi adicionada no ensaio posterior, portanto não existe CPU/RAM de filhos comparável na baseline original. I/O físico e rede externa não são inferidos de tamanho de arquivo ou taxa mock. Métricas não instrumentadas são explicitamente marcadas como não medidas. Crescimento de armazenamento de metadados é medido; ensaio posterior grava cópias reais para o caso de derivações idênticas repetidas.

A baseline original possui worker serial. O harness posterior usa os slots configurados (2). A fixture e o atraso mock de 30 ms são os mesmos; variações de carga no desktop não são controladas como em um laboratório. O caminho manual requestVideoVersion foi mantido e permite reproduzir o preprocessing antigo no mesmo harness posterior, rotulado eager-replay; isso não é uma execução do binário anterior.
