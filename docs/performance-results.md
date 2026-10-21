# Resultados de performance — 2026-10-07

Dados medidos: [baseline](benchmarks/before.json), [posterior](benchmarks/after.json), [200 por conta](benchmarks/account-capacity.json), [storage](benchmarks/storage.json). Primeiros ensaios estão preservados em after-first/account-capacity-first. A última execução de cada cenário substitui somente seu próprio resultado. Ensaios de performance finais foram executados separadamente; o desktop e processos externos não constituem laboratório controlado. Não atribuir toda variação observada a uma alteração específica.

## Hardware e escopo

CPU Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz; 12 threads lógicas, 6 núcleos físicos (CIM); RAM 16297.57 MB. Discos informados pelo Windows: KINGSTON SA400S37240G 240 GB e WDC WD10EURX 1 TB. Diretório temporário no volume C:. Link Ethernet negociado 1 Gbps; banda efetiva de internet não medida. SQLite WAL em arquivo, uma conexão no harness; app usa main + utility process, sem pool/Redis.

Fixture FFmpeg real: 360×640, 4 s, áudio sintético, capa PNG; entrada 301850 bytes, derivado 832241 bytes. O ensaio tem oito edições por nível de concorrência; p99 é o máximo da amostra, não uma cauda estatística robusta. Não extrapolar para vídeos longos/1080p/VFR.

## Antes × Depois

| Métrica | Atual / referência | Novo | Diferença observada |
| --- | --- | --- | --- |
| 40 intenções: recibo (replay do caminho antigo × JIT) | 219.59 ms | 261.13 ms | 41.54 (18.92%) |
| Edições executadas antes do horário | 40 | 0 | -40 |
| Preprocessing antecipado de 40 (replay × JIT) | 22291.98 ms | 0.79 ms | -22291.18 (-100.00%) |
| 40 jobs com polling mock 30 ms: total | 1601.35 ms | 205.30 ms | -1396.05 (-87.18%) |
| 40 jobs mock: latência de conclusão p95 | 1531.08 ms | 192.50 ms | -1338.58 (-87.43%) |
| 40 jobs mock: jobs/min | 1498.73 | 11690.13 | 10191.40 (680.00%) |
| FFmpeg p95, concurrency=1, fixture 4 s | 758.62 ms | 839.17 ms | 80.56 (10.62%) |
| CPU pico do sistema (baseline comparável) | não medido | não medido | — |
| RAM pico do harness (workloads diferentes) | 205.67 MB | 204.02 MB | não comparável |
| Falhas no cenário de fila sem injeção | 0 | 0 | 0 |
| Retry recovery com falha deliberada | sem ensaio comparável na baseline | 429/500/checkpoints/crash de lease em testes | — |
| Disco temporário durante upload real | não medido | não medido; disco de derivados em ensaio separado | — |

As duas linhas de recibo/preprocessing reproduzem o caminho antigo mantido para edição manual no binário posterior. Elas demonstram que JIT adia o trabalho; não demonstram que FFmpeg codifica mais rápido. A tabela de polling usa a baseline anterior capturada antes das alterações e o worker posterior (2 slots) com o mesmo atraso mock. Falhas e melhoria de recovery não receberam percentuais inventados.

## SQLite: 1/10/25/40/50/100/200 jobs e 1/3/5/10 destinos mock

| Jobs | Contas mock | Enqueue antes ms | Enqueue depois ms | Claim p95 antes ms | Claim p95 depois ms | Lag p95 antes ms | Lag p95 depois ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1.59 | 1.57 | 2.20 | 2.74 | 24.00 | 19.00 |
| 10 | 1 | 5.38 | 4.10 | 1.51 | 1.87 | 23.00 | 21.00 |
| 25 | 1 | 6.60 | 7.21 | 0.80 | 1.18 | 31.00 | 39.00 |
| 40 | 1 | 10.44 | 11.35 | 0.82 | 1.03 | 48.00 | 60.00 |
| 50 | 1 | 8.97 | 9.79 | 0.95 | 1.09 | 55.00 | 72.00 |
| 100 | 1 | 19.63 | 21.67 | 0.72 | 1.17 | 122.00 | 250.00 |
| 200 | 1 | 34.88 | 39.58 | 0.73 | 1.37 | 316.00 | 345.00 |
| 1 | 3 | 0.30 | 0.43 | 0.52 | 0.79 | 1.00 | 1.00 |
| 10 | 3 | 2.33 | 2.13 | 0.93 | 0.92 | 11.00 | 13.00 |
| 25 | 3 | 5.49 | 4.89 | 0.98 | 0.91 | 27.00 | 33.00 |
| 40 | 3 | 7.34 | 7.39 | 1.26 | 0.95 | 57.00 | 51.00 |
| 50 | 3 | 10.40 | 9.02 | 1.30 | 1.33 | 61.00 | 69.00 |
| 100 | 3 | 16.82 | 29.62 | 0.73 | 1.13 | 120.00 | 165.00 |
| 200 | 3 | 31.42 | 41.38 | 0.77 | 1.21 | 233.00 | 1538.00 |
| 1 | 5 | 0.39 | 0.42 | 0.55 | 0.81 | 2.00 | 2.00 |
| 10 | 5 | 1.66 | 1.89 | 0.61 | 1.05 | 9.00 | 13.00 |
| 25 | 5 | 3.73 | 4.64 | 0.58 | 0.84 | 22.00 | 30.00 |
| 40 | 5 | 6.48 | 7.04 | 0.68 | 1.00 | 35.00 | 50.00 |
| 50 | 5 | 8.18 | 8.71 | 0.86 | 1.00 | 51.00 | 62.00 |
| 100 | 5 | 15.17 | 17.53 | 0.86 | 0.99 | 161.00 | 659.00 |
| 200 | 5 | 31.61 | 37.38 | 0.69 | 1.33 | 208.00 | 1415.00 |
| 1 | 10 | 0.29 | 0.42 | 0.50 | 0.88 | 1.00 | 2.00 |
| 10 | 10 | 2.77 | 2.07 | 0.88 | 0.95 | 14.00 | 14.00 |
| 25 | 10 | 3.69 | 4.52 | 0.56 | 1.00 | 22.00 | 32.00 |
| 40 | 10 | 6.72 | 7.15 | 0.72 | 1.10 | 38.00 | 56.00 |
| 50 | 10 | 14.14 | 9.07 | 0.78 | 1.08 | 54.00 | 66.00 |
| 100 | 10 | 20.09 | 17.63 | 1.51 | 1.22 | 230.00 | 215.00 |
| 200 | 10 | 31.21 | 37.33 | 0.76 | 1.54 | 213.00 | 355.00 |

Todos esses casos completaram sem falha. JSON inclui p50/p90/p95/p99/max de claim/lag/duração e jobs/min. Contas do ensaio simples são IDs de roteamento, não integrações reais. Claim/complete exercitam SQLite real, mas não passam por mídia/API. Scheduler usa state/priority/run_at e filtros de capacidade, com claim transacional IMMEDIATE. Ainda há custo de JSON e subconsultas de limites; N+1 de leitura da página de fila permanece na auditoria.

## FFmpeg: concurrency 1/2/4/8

| Conc. | p50 ms | p90 ms | p95 ms | p99 ms | max ms | ratio p50 | 8 jobs total ms | RSS filhos pico amostrado | CPU filhos pico observado | Read/write observados | Amostras |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 431.10 | 839.17 | 839.17 | 839.17 | 839.17 | 0.11 | 4695.41 | 115.80 MB | 17.92% | 40.77/2.37 MB | 13 |
| 2 | 505.56 | 649.90 | 649.90 | 649.90 | 649.90 | 0.13 | 2565.87 | 234.83 MB | 32.04% | 41.74/2.58 MB | 8 |
| 4 | 650.46 | 670.46 | 670.46 | 670.46 | 670.46 | 0.16 | 1513.91 | 470.34 MB | 41.91% | 43.04/2.87 MB | 3 |
| 8 | 1074.24 | 1105.74 | 1105.74 | 1105.74 | 1105.74 | 0.27 | 1242.76 | 854.38 MB | 84.65% | 41.55/5.33 MB | 3 |

CPU é derivada dos contadores de processos observados, normalizada por 12 threads; processos curtos podem escapar entre amostras e a primeira amostra não fornece delta. RAM é a soma observada dos filhos FFmpeg no instante da coleta. Read/write são soma dos máximos observados por PID: limite inferior de I/O de processo, incluindo cache do SO, **não I/O físico de disco**. Dados brutos timestamp/PID estão no JSON. Baseline original não tinha coletor de filhos; não há comparação causal de CPU/RAM dos filhos.

Instrumentação do harness: CPU user/system 5235000/1750000 µs, RSS pico 204.02 MB, event-loop p95 22.04 ms. Workload posterior inclui replay de 40 edições e sampler PowerShell, logo CPU/RSS agregado não é comparável ao harness inicial. Não há medição de saturação de threads do app.

## 200 jobs por conta no pipeline de publicação

Registro de contas, credenciais, claim, checkpoints, histórico e confirmação são reais. Preparação/transferência são mocks e cada request tem atraso artificial de 1 ms. **Nenhuma chamada às plataformas.**

| Contas registradas | Jobs/conta | Total | Enqueue ms | Drenagem ms | Jobs/h mock | Running pico | Requests mock | Credencial cruzada | Falhas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 200 | 200 | 367.73 | 9356.07 | 76955.43 | 1 | 600 | 0 | 0 |
| 3 | 200 | 600 | 1191.30 | 7473.14 | 289035.05 | 2 | 1800 | 0 | 0 |
| 5 | 200 | 1000 | 2402.83 | 17555.28 | 205066.55 | 2 | 3000 | 0 | 0 |
| 10 | 200 | 2000 | 19563.76 | 31338.36 | 229750.36 | 2 | 6000 | 0 | 0 |

Cada JSON contém percentis por job e de conclusão do lote. Os casos de 1 conta usam um slot; casos de múltiplas contas atingem dois. Dez destinos são testados como elegíveis, mas não dez uploads/FFmpeg simultâneos. Crescimento/degradação de filas é observável; o máximo de throughput desta amostra é 289035.05 jobs/h **no mock**, não capacidade confortável de produção.

## Armazenamento

Metadados SQLite após fechar/checkpointar WAL:

| Intenções | Baseline bytes | Posterior bytes |
| --- | --- | --- |
| 100 | 225280 | 294912 |
| 500 | 405504 | 581632 |
| 1000 | 655360 | 958464 |
| 5000 | 2547712 | 3944448 |

Ensaio de arquivos reais: o mesmo original/capa/opções repetido, sem hard links; cópias de derivados geradas em pasta temporária. Total de 20036 ms de cópias/leituras de metadados. Tamanho lógico medido, não blocos físicos alocados.

| Publicações repetidas | Arquivos antigos | Bytes antigos | Arquivos no cache idêntico | Bytes cache JIT | Cópia incremental ms |
| --- | --- | --- | --- | --- | --- |
| 100 | 100 | 83224100 | 1 | 832241 | 101.42 |
| 500 | 500 | 416120500 | 1 | 832241 | 416.62 |
| 1000 | 1000 | 832241000 | 1 | 832241 | 1168.06 |
| 5000 | 5000 | 4161205000 | 1 | 832241 | 18349.14 |

Não usar esses números para 5000 vídeos/configurações diferentes: nesse caso cache cresce por derivação única. Originais são preservados e não multiplicados por repostagem. Não foram feitos 5000 uploads nem publicações reais.

## Capacidade operacional

- Recepção de 200 intenções: testada; 200 por conta: testada com 1/3/5/10 contas e até 2000 jobs no pipeline com provider mock.
- Fila de metadados testada: 5000 jobs. Disco de derivados repetidos: 5000 arquivos no replay.
- Padrão para piloto: 1 utility process, 2 slots, 1 media slot, 2 exposições/upload slots, 2 publish slots, 1 por conta. Isso é proteção de recursos, não certificação de SLA.
- Carga confortável real em jobs/h: **não determinada**. Máxima real end-to-end: **não determinada**. Internet, transferência por tunnel, processamento/confirmacão Meta e quotas não foram medidos.
- Ponto de saturação de produção: **não determinado**. A concorrência 8 de mídia aumenta latência individual; não foi medido o ponto de colapso. Dados não justificam 8 FFmpeg de produção.
- Limite externo: independente; content_publishing_limit, rate headers, permissões e políticas precisam validação oficial/conta real. Não adotar taxa mock como limite das APIs.

## Reprodução

Executar benchmarks separadamente. PowerShell:

```powershell
$env:LEGACY_BENCHMARK='after'; $env:MEDIA_CONCURRENCY='8'
npm test -- src/main/audit/pipeline-benchmark.test.ts
$env:LEGACY_BENCHMARK=$null; $env:MEDIA_CONCURRENCY=$null
$env:LEGACY_CAPACITY_BENCH='1'
npm test -- src/main/audit/account-capacity.test.ts
$env:LEGACY_CAPACITY_BENCH=$null
$env:LEGACY_STORAGE_BENCH='1'
npm test -- src/main/audit/storage-benchmark.test.ts
$env:LEGACY_STORAGE_BENCH=$null
node scripts/report-pipeline-benchmarks.mjs
```

Não sobrescrever before.json com o binário posterior e chamar isso de baseline. A baseline é evidência histórica. Armazenamento exige reserva de 4 GiB além das cópias. Suíte normal pula os três benchmarks e executa os testes de resiliência.
