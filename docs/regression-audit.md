# Auditoria de regressão — 7 de outubro de 2026

## Resultado e limites

Cinco publicações reais foram concluídas em `@365jonvlogs`, sem duplicação no histórico: um vídeo com capa, lote de três e um vídeo com reinício real durante PROVIDER_PROCESSING. Foram corrigidas falhas de FFmpeg, consultas da Fila, polling oculto, consulta da Biblioteca, animação contínua em repouso, layout do Collapsible e renderização excessiva do console de diagnóstico. JIT, checkpoints, idempotência, isolamento por conta e fencing foram preservados.

Este relatório **não certifica todos os critérios de conclusão**: parte da matriz de falhas usa transporte controlado; o trace inicial de uma publicação não contém todos os campos de fencing por operação; long tasks continuam presentes. O lote externo posterior possui logs de fencing reais. As medições e limitações são detalhadas em [QA](qa-results.md) e [performance](performance-regression.md).

## Método e baseline

Antes de editar código, foram examinados o processo Electron em execução, banco real em modo somente leitura, diagnósticos das publicações falhadas e executada reprodução real do FFmpeg com o vídeo/capa existentes. A interface foi medida em Electron com cópia SQLite e perfil Chromium. Nenhuma causa foi declarada apenas por leitura de código.

Baseline: HEAD `5fc94eb`, Legacy 0.7.5, Windows, timezone `America/Sao_Paulo`. Havia alterações locais extensas da auditoria anterior e da interface. A auditoria anterior não constitui um commit isolado: `git bisect` não pode separar essas mudanças com confiança. A comparação é entre o working tree recebido, HEAD e as medições antes/depois desta intervenção. Não houve reset ou reversão geral.

O banco inicial tinha zero jobs `queued/running`, zero jobs elegíveis e nenhum cooldown em `provider_limits`. Publicações: 86 concluídas, 7 falhadas, 144 canceladas. Isso não evidencia um scheduler bloqueando todos os jobs; os dois erros mais recentes estavam em `PREPARING_MEDIA`. Evidência: [db-before.json](benchmarks/regression/db-before.json).

Os benchmarks de interface usam backup SQLite separado, removem credenciais da cópia e cancelam seus jobs ativos. A publicação real foi autorizada pelo usuário e executada separadamente no perfil real. Tokens não são registrados.

## CAUSA 1 — FFmpeg rejeita a preparação com capa

**Sintoma:** publicação falha antes de enviar a mídia à Meta.

**Reprodução:** vídeo original 720×1280, aproximadamente 29,801 fps, AAC, 8.684 ms; versão planejada com capa. Job original `53131548-ca89-45ad-8031-6006db3b678b`, asset `768aee74-94ee-41cd-af19-cda5be7c0672`.

**Causa raiz:** concatenação da capa de 30 fps com vídeo de taxa fracionária seguida de saída VFR para o encoder Windows `h264_mf`. O encoder terminou com código `3752568763` e stderr `could not open encoder before EOF`. Não foi um worker aguardando um FFmpeg já encerrado: o processo terminou e o erro foi propagado.

**Evidência:** reprodução com o mesmo input/capa e trecho de dois segundos: VFR falhou em 436,33 ms; CFR 30 fps e time base 1:30 concluiu em 516,60 ms; libopenh264 VFR também concluiu. [encoder-before.json](benchmarks/regression/encoder-before.json). O stderr integral está nesse arquivo.

**Arquivo/correção:** `src/main/media/ops.ts`, configuração `timing`: apenas `h264_mf` recebe `-fps_mode cfr -r 30 -enc_time_base 1:30`. Outros encoders mantêm VFR. Sem substituir o pipeline ou remover JIT.

**Teste criado:** `src/main/media/ops.test.ts`, vídeo fracionário real com capa, probe e decode integral. Na publicação real posterior, renderização encerrou com exit 0 em 1.379,60 ms; preparação chegou a `MEDIA_READY` em 1.862 ms.

**Relação com a auditoria anterior:** a configuração VFR já existia no HEAD. A migração da edição para o momento da publicação passou a expor a falha nessa etapa crítica. A evidência não permite atribuir a criação do bug do encoder à auditoria anterior.

## CAUSA 2 — N+1 na Fila

**Sintoma:** abertura e atualização da Fila multiplicam consultas conforme a quantidade de linhas.

**Reprodução/evidência:** Electron, mesma cópia com 1.415 jobs, `jobs.query` via IPC; wrappers no SQLite nativo contam/timam `all/get/run`, sem registrar parâmetros. [Antes](benchmarks/regression/before-queries.json), [depois](benchmarks/regression/after-queries.json).

| Página | SQL antes | SQL depois | IPC antes | IPC depois | SQL antes/depois |
|---|---:|---:|---:|---:|---:|
| 25 jobs | 202 | 8 | 50,70 ms | 15,50 ms | 9,94 / 5,60 ms |
| 100 jobs | 739 | 8 | 140,90 ms | 23,80 ms | 24,25 / 7,98 ms |

**Causa raiz:** consultas por linha de publicação, post, perfil, asset, tentativa e avatar, acrescidas pelo novo contexto do monitor. O HEAD já tinha parte das consultas por publicação; a amplificação de contexto está nas alterações da auditoria.

**Arquivo/correção:** `src/main/queue/queue.ts: queryJobs` e `src/main/services/queue-monitor.ts: loadQueueRelations/queueContext`; relações carregadas em lote somente para IDs da página, depois consultadas em mapas.

**Teste criado:** `queue-monitor.test.ts`, páginas de 25, 100 e 500 no serviço com máximo de oito SQL. O contrato IPC limita páginas a 100: 500 não é uma listagem permitida pela interface. Os testes de stress confirmam 25 linhas renderizadas mesmo com 5.000 jobs.

## CAUSA 3 — Polling pesado mesmo com Diagnóstico fechado

**Sintoma:** atividade SQL contínua na Biblioteca sem jobs ativos.

**Causa raiz:** `DiagnosticPanel` montado no footer consultava pipeline e Fila detalhada de 100 linhas mesmo fechado. O resumo do footer também consultava os dados que o Mascot já buscava. Essa carga foi amplificada pelo N+1.

**Evidência:** no mesmo procedimento de 20 segundos em repouso, 3.473 SQL antes versus 177 depois. Os arquivos `before-clean-idle-idle-sql.json` e `after-idle-sql.json` excluem o trecho de navegação. A redução resulta conjuntamente da correção do N+1 e do polling; não foi medida uma contribuição isolada para cada uma.

**Arquivo/correção:** `src/renderer/components/DiagnosticPanel.tsx`: pipeline somente com painel aberto na aba processador; Fila detalhada somente aberta na aba Fila; resumo usa a chave compartilhada `queue-summary`. Não se consolidaram consultas de semânticas distintas.

**Validação:** teste Electron de Diagnóstico com abertura, busca, rede, resize, navegação e exportação; benchmarks em repouso. O painel continua atualizando quando aberto.

## CAUSA 4 — Consulta da Biblioteca bloqueia o main process

**Sintoma:** SQL de atualização da Biblioteca chegou a 115,55 ms; perfil do main encontrou tempo amostrado significativo em `all` do SQLite nativo.

**Reprodução:** consulta exata capturada no trace, mesmos parâmetros e banco real somente leitura; experimentos de índices executados em backup, 15 execuções por variante. Comparação de todos os resultados serializados.

**Causa raiz:** estado correlacionado por mídia, busca de jobs por workspace sem índice direto de estado, e ordenação `imported_at IS NULL` apesar de `imported_at` obrigatório. O plano precisava de ordenação temporária e impedia aproveitar a paginação por índice.

**Evidência:** média 53,33 ms original; 27,50 ms com índice de jobs; 10,22 ms com índice de importação e ordenação compatível. Os mesmos 60 resultados foram preservados. Uma variante com guarda de `postId` não trouxe melhora suficiente e não foi aplicada. [Planos e tempos](benchmarks/regression/library-sql-experiment.json).

**Arquivo/correção:** `src/main/services/grid.ts: orderFor` omite a ordenação por NULL somente em colunas obrigatórias; `schema.ts` e migração `0007_regression_library_indexes.sql` adicionam `jobs(workspace_id,state)` e `media_assets(workspace_id,imported_at DESC,id)`.

**Teste criado:** paginação por importação com desempate, resultados e plano sem `TEMP B-TREE`; regressões existentes de métricas nulas, estados, filtros, exclusão e histórico passaram. Os índices anteriores foram preservados. A consulta já existia antes da auditoria; trata-se de gargalo comprovado, não de atribuição temporal ao novo scheduler.

## CAUSA 5 — Animação de repouso mantém GPU e renderer ativos

**Sintoma:** CPU contínua no processo GPU e renderer sem tarefas.

**Causa raiz:** float, blink e outros movimentos SVG repetiam indefinidamente nos estados sem trabalho ativo.

**Evidência:** alternar `prefers-reduced-motion` no mesmo Electron reduziu CPU sustentada GPU de 3,27% para 0,027% e renderer de 1,57% para 0,129%. A medição posterior de cinco minutos com CSS corrigido está no relatório de performance.

**Arquivo/correção:** `src/renderer/components/brand/brand.css`: animações dos estados em repouso encerram após duas iterações; estados de processamento, upload e publicação mantêm animação de atividade. Nenhum timer novo.

**Validação:** benchmark por processo antes/depois, mantendo a preferência normal de movimento na medição posterior. Esse comportamento de animação era preexistente, e não foi atribuído à auditoria anterior.

## Correção adicional — classificação de erros Meta

`InstagramApiError` classificava 429/5xx como `invalid_input`, embora o worker já reconhecesse a condição retryable. Agora erros HTTP 429/5xx e códigos transientes recebem `internal`, preservando status, cooldown e checkpoints. Testes 429, 500 e 503 falhavam antes da correção e passaram depois. Arquivo `src/main/services/instagram-publishing.ts`; não foi essa a causa da publicação real que falhava em FFmpeg.

## CAUSA 6 — Collapsible força cálculo de estilo no commit

**Sintoma/reprodução:** repetir 50 entradas/saídas da Fila; CPU profile registra 1.223,76 ms acumulados na leitura de `animationName` do Presence Radix usado pelo Collapsible.

**Causa:** conteúdo `forceMount` passava por medição síncrona do Radix, embora o grid CSS já tratasse altura dinâmica e preservasse os campos montados.

**Correção:** `src/renderer/components/ui/Collapsible.tsx:37`, conteúdo nativo mantendo Root/Trigger, ID ARIA, inert, aria-hidden e grid existente. Tempo nessa leitura: 1.223,76→0 ms; navegação média 146,77→130,60 ms; p95 paint opportunity 125,8→108,2 ms; long task máxima 145→115 ms. O alerta de 100 ms continua excedido.

**Testes:** teclado, disabled, modo controlado, preservação de formulário e Playwright com threshold de expansão. Evidências `final-clean-renderer-cpu.json` e `collapsible-after-renderer-cpu.json`. Componente preexistente; não se atribuiu sua criação ao novo scheduler.

Localização das outras correções: `ops.ts:97`; `queue.ts:182` e `queue-monitor.ts:13`; `DiagnosticPanel.tsx:167`; `grid.ts:15` e migração 0007; `brand.css:24`; `instagram-publishing.ts:29`.

## CAUSA 7 — Diagnóstico monta milhares de logs e detalhes fechados

**Sintoma:** no soak, o React Profiler registrou render máximo de 1.129 ms no Diagnóstico, p95 403,5 ms; abertura e busca ficaram lentas conforme o histórico aumentava.

**Reprodução:** sem alterar a versão compilada inicial dessa etapa, inserir 2.000 eventos reais no coletor do main, abrir console e buscar evento antigo. Electron mediu 938,14 ms para abrir, 1.137,48 ms para buscar; 2.000 linhas e 26.107 nós no painel. [Antes](benchmarks/regression/diagnostics-before.json).

**Causa raiz:** `DiagnosticPanel.tsx` montava todos os grupos, inclusive detalhes de Collapsibles fechados; serializava ocorrências mesmo com query vazia. Esse painel foi introduzido pela auditoria anterior.

**Correção:** página de 25 grupos, detalhes somente expandidos e no máximo 25 ocorrências por página; busca automática encontra a página do evento e da ocorrência; cálculo de grupos somente quando console está aberto, e serialização de busca somente com texto. Captura e exportação completas são preservadas. Estado de paginação de ocorrências expiradas é removido.

**Depois:** abertura 122,37 ms, busca 68,23 ms, 25 linhas e 388 nós. Um grupo com 2.000 ocorrências também renderiza somente 25 detalhes, com busca de ocorrência antiga e navegação testadas. [Depois](benchmarks/regression/diagnostics-after.json).

**Teste criado:** `tests/e2e/diagnostics-performance.spec.ts`, thresholds <500 ms, quantidade limitada no DOM e busca além da página inicial. Integração de busca, pausa, filtros, detalhes, resize e exportação passou novamente.

## Lote externo e restart real posteriores

Três vídeos inéditos para esse destino foram enfileirados para execução imediata. Três IDs elegíveis iniciais, três IDs executados e três confirmações. Foram 15 chamadas Meta HTTP 200 e 40 operações de fencing aceitas, nenhuma rejeitada. Leases finais 3/3/5 e attempts 1; leases adicionais correspondem aos polls/backpressure. [Confirmações](benchmarks/regression/live-batch-confirmation.json), [leases e HTTP](benchmarks/regression/live-batch-events.json), [timeline](benchmarks/regression/live-batch-timeline.json).

O quinto teste externo, job `3ab08a39-3eb1-42ba-96b9-d07bf26d29b1`, reiniciou após salvar container `18138891721570003` e defer em PROVIDER_PROCESSING. Worker mudou de `worker-115072` para `worker-112540`. Retomada confirmou mediaId `18088380992697596`, exatamente um POST de criação, um POST publish e um histórico. [Antes](benchmarks/regression/live-restart-before.json), [depois](benchmarks/regression/live-restart-after.json), [histórico](benchmarks/regression/live-restart-history.json). Foi um reinício gracioso, não queda de energia ou kill durante resposta HTTP ambígua.

A primeira tentativa de abrir o lote foi impedida pelo single-instance lock da versão instalada aberta pelo usuário; nenhuma intenção foi criada nesse lançamento. Após verificar zero jobs queued/running, essa instância foi encerrada e o build corrigido abriu o perfil real. Não foi classificado como falha de scheduler.

## Pipeline inicial observado

Job `d6fba179-a1cd-466e-8c8a-bfa334fb3333`, accountId `17841417100073745`, worker utility PID `71536`. Timestamps UTC; horário local UTC−3.

| Evento | Timestamp UTC | Estado/dado |
|---|---|---|
| Intenção | 22:04:00.675 | queued, attempts 0 |
| Executar agora | 22:04:00.735 | run_at atualizado |
| Claim | 22:04:01.514 | running, attempts 1 |
| PREPARING_MEDIA | 22:04:01.541 | início JIT |
| FFmpeg start/end | 22:04:01.844 / 22:04:03.217 | exit 0 |
| MEDIA_READY | 22:04:03.403 | preparação 1.862 ms |
| UPLOADING | 22:04:03.404 | preparando exposição pública |
| Exposição pronta | 22:05:16.450 | preflight do túnel consumiu aproximadamente 73 s |
| Container criado | 22:05:17.773 | HTTP 200, 1.322 ms |
| PROVIDER_PROCESSING | 22:05:17.774 | container 18138879934570003 |
| Poll/defer | 22:05:17.983 | queued, attempts 0, nextRunAt 22:05:32.983 |
| Segundo claim | 22:05:33.113 | running, attempts 1 |
| PUBLISHING | 22:05:33.337 | provider pronto |
| WAITING_CONFIRMATION | 22:05:39.848 | publish retornou HTTP 200 |
| CONFIRMED | 22:05:39.849 | mediaId 17947428987342635 |
| Histórico | 22:05:39.850 | exatamente um registro |

Lease final 2, erro final null. O trace real original não registrou expected/actual lease em cada operação; não foi refeito para criar outra publicação. `traceLease`, atrás de `LEGACY_PERF_DEBUG=1`, registra workerId, jobId, expectedLease, actualLease, operação e aceite/rejeição nas execuções controladas posteriores. Não se substituiu essa lacuna por valores inferidos.

Endpoints reais `/v25.0/17841417100073745/media`, `/v25.0/18138879934570003?fields=status_code,status`, `/v25.0/17841417100073745/media_publish`: todos 200. POST publish 6.508 ms; polls 206 e 217 ms. Request IDs constam de [live-events.json](benchmarks/regression/live-events.json); são correlações locais do Legacy, não IDs `x-fb-request-id`. [Confirmação persistida](benchmarks/regression/live-confirmation.json).

O tempo de exposição pública foi separado do FFmpeg e do POST Meta. Ele permanece uma latência relevante, não foi ocultado com spinner nem chamado de erro de API.

## Scheduler, capacidade, contas e cache

Não foi reproduzido filtro eliminando todos os jobs nem slot permanentemente ocupado. Na publicação real houve defer persistido de 15 s e retomada. Nos cenários controlados 1/2/3/5/10, elegíveis = encontrados = jobs únicos claimed = concluídos; o total de claims é maior devido ao polling/backpressure. HTTP e mídia são controlados nesses cenários, o scheduler e banco são reais.

Fencing rejeita heartbeat/complete/fail/defer da lease antiga e aceita a atual. A matriz de credenciais altera a conta default após agendar e valida o snapshot do worker e token de cada destino, sem registrar valores reais. A publicação externa confirma que o token armazenado chegou ao provider correto.

Cache: testes reais de derivação confirmam deduplicação em execução, hit persistido, reconstrução após corrupção e original intacto. Tempos de hash/leitura, hit/probe e miss são registrados somente sob `LEGACY_PERF_DEBUG=1`; evidência `cache.json`. Hash/leitura são medidos conjuntamente por stream; não há um tempo de I/O isolado do custo SHA. Não se encontrou loop de cache miss nesses cenários.

## Reprodução das medições

```powershell
$env:LEGACY_PERF_DEBUG='1'
npm run build
$env:LEGACY_IDLE_SECONDS='300'
$env:LEGACY_MAIN_PROFILE='1'
node scripts/regression-runtime.cjs final
npm test -- --maxWorkers=2
npx playwright test tests/e2e/regression-performance.spec.ts tests/e2e/publishing-ui.spec.ts tests/e2e/pipeline-jit.spec.ts tests/e2e/diagnostics.spec.ts tests/e2e/queue-operations.spec.ts
node scripts/report-regression.cjs
```

O script `regression-live.cjs` publica de verdade e exige opt-in explícito; não executar como parte de CI ou apenas para regenerar evidências. A aplicação entregue é recompilada sem a flag de profiling.
