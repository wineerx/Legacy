# Performance de regressão — 7 de outubro de 2026

## Condições e arquivos

Windows, Electron 42.11.10, Legacy 0.7.5; mesmo banco copiado para os passes comparáveis antes/depois da Fila, 1.415 jobs. A publicação controlada adicionou um job, portanto os passes finais têm 1.416. Nenhum token permanece nas cópias de benchmark. Evidência bruta: [benchmarks/regression](benchmarks/regression/), agregação por `scripts/report-regression.cjs` em `summary.json`.

Instrumentação: wrappers de SQL nativo; IPC real Playwright/Electron; `PerformanceObserver(longtask)`; pointerdown + dois requestAnimationFrame; CDP CPU profiler/heap snapshots; React profiling build; `app.getAppMetrics` separado por processo. A oportunidade de paint não é uma medição de pixels efetivamente apresentados. Os custos de profiling, tracing e automação existem e são explicitados.

Não foram reconstruídos retroativamente timestamps de handler/main receive ausentes. IPC roundtrip e duração SQL/render foram medidos, mas não formam um único span ponta a ponta de todas as ações.

## Fila: consultas e IPC

| Jobs da página | Consultas antes/depois | Queries/job antes/depois | IPC antes/depois | SQL antes/depois |
|---:|---:|---:|---:|---:|
| 25 | 202 / 8 | 8,08 / 0,32 | 50,70 / 15,50 ms | 9,94 / 5,60 ms |
| 100 | 739 / 8 | 7,39 / 0,08 | 140,90 / 23,80 ms | 24,25 / 7,98 ms |

O total é constante em oito consultas; algumas relações ausentes podem reduzir esse número. As queries individuais e respectivos tempos estão em `before-queries.json` e `after-queries.json`. O teste do serviço cobre 500 linhas; IPC/produção limita a página a 100, e UI usa 25. Não foi ampliado esse limite para produzir um benchmark artificial de 500 cards.

Repouso comparável de 20 s: 3.473 SQL/527,31 ms antes; 177 SQL/419,42 ms depois de corrigir N+1 e polling oculto. A redução no tempo SQL foi menor que a redução de quantidade porque a consulta correlacionada da Biblioteca continuava dominando; ela foi investigada e corrigida separadamente.

## Biblioteca: plano e bloqueio no main

Consulta capturada chegou a 115,55 ms. Experimento com 15 repetições e resultados idênticos: média original 53,33 ms; índice workspace/state 27,50 ms; índice por importação e remoção do sort por NULL obrigatório 10,22 ms. O plano final permite usar `media_assets_ws_imported` em vez de ordenar toda a coleção antes do limite.

O profile de main anterior aos índices acumulou cerca de 950,82 ms de amostras self em `all` nativo. Também mostrou aproximadamente 404,09 ms em criação de `PathEscapeError` e 243,41 ms em normalização de paths durante resolução de miniaturas externas. Esse segundo custo é preexistente e não foi alterado: reduzir verificações de caminhos requer preservar a autorização do protocolo de mídia. O perfil bruto está em `main-profile-main-cpu.json`.

Após as correções, a medição de cinco minutos `final` teve 2.689 consultas, 2.265,30 ms totais de SQL e consulta mais lenta de 17,01 ms. Não houve SQL >50 ms nesse passe. O main profiler estava ativo nesse passe; não se atribui toda a CPU desse processo ao produto sem overhead.

## CPU em repouso, separada por processo

Cinco minutos, amostras a cada cinco segundos, sem jobs ativos. `percentCPUUsage` é o valor reportado pelo Electron; não é CPU total do sistema. A primeira amostra, que não representa um intervalo completo, foi excluída da média sustentada abaixo.

| Processo | Antes, cinco minutos | Depois, cinco minutos (`final`) |
|---|---:|---:|
| Main / Browser | 0,291% | 0,456% com profiler main ativo |
| GPU | 2,496% | 0,0067% |
| Renderer / Tab | 1,192% | 0,0727% |
| Utility / Legacy worker | 0,0181% | 0,0180% |

Aumento aparente de main não é apresentado como melhora. O experimento causal no mesmo app com `prefers-reduced-motion` eliminou a maior parte da atividade GPU/renderer. Depois a correção CSS limitou animações de estados sem trabalho a duas iterações, preservando movimentos durante processamento. Um passe de cinco minutos só com essa correção, sem profiler main, teve main 0,321%, GPU 0,0055% e renderer 0,0686%.

O primeiro `final-clean` concluiu navegação mas foi interrompido com `Target page ... closed` durante o repouso; não existe resultado completo de idle desse passe. `final-clean-retry` repetiu os cinco minutos sem profiler main. Dados brutos de ambos são preservados; somente passes completos são usados para declarar cinco minutos medidos.

CPU/RAM de Main, Renderer, GPU, utility e network service estão em cada arquivo `*-idle.json`; os picos de working set são agregados em `summary.json`. Não foi produzido CPU call-stack profile próprio do utility nem pico confiável do FFmpeg da primeira publicação externa.

## Renderer, React e interações

Passes comparáveis de 100 ações Fila↔Biblioteca: média antes 141,07 ms; depois de batching/polling 132,68 ms. O segundo passe registrou pointerdown→oportunidade de paint p50 81,1 ms e p95 97,9 ms. O renderer ainda registrou 98 long tasks >50 ms, máximo 99 ms. Os arquivos `*-navigation.json` listam **todas** as long tasks observadas, com start e duration; não se descartaram tarefas longas para declarar sucesso.

Um passe final concorrente com a suíte completa teve média 284,62 ms e p95 230 ms; os profiles React desse passe também foram mais lentos. Essa medição sob carga permanece em `final-*`, mas não é comparada como se fosse o mesmo ambiente de carga do baseline. A repetição sem suíte em paralelo (`final-clean`) teve média 146,77 ms, p95 125,8 ms, 101 long tasks e máximo 145 ms.

### Collapsible: custo de layout reproduzido

O CPU profile identificou 1.223,76 ms em `getAnimationName$2` do Presence usado pelo Collapsible durante 100 navegações. A leitura de `animationName` de um `getComputedStyle` força resolução de estilo no commit. O componente também media altura pelo Radix, apesar de já usar grid CSS para altura dinâmica e manter os formulários montados.

`src/renderer/components/ui/Collapsible.tsx` mantém Root/Trigger Radix, controle de open, IDs ARIA e teclado; o conteúdo usa div com `inert`, `aria-hidden` e o mesmo grid. Não há cálculo manual de altura, timer ou nova arquitetura de estados.

Comparação `final-clean` versus `collapsible-after`: tempo self de leitura de estilo 1.223,76→0 ms; média de navegação 146,77→130,60 ms; p95 paint opportunity 125,8→108,2 ms; long task máxima 145→115 ms. O alerta de 100 ms continua excedido no p95. Testes de teclado, disabled, controle externo e preservação de valores passaram. O E2E de expansão mediu 6,1 ms até oportunidade de paint e 49,16 ms com automação no passe registrado.

React `Profiler` está aplicado à Sidebar, página ativa e Diagnóstico somente em build `LEGACY_PERF_DEBUG=1`. `actualDuration` é duração de render; `commitTime` é um timestamp, **não duração do commit**. Não foi medida duração de commit específica, nem isolado um componente MediaGrid da página. Os dados brutos permitem localizar os renders por intervalo de interação, mas não há uma alegação de que cada clique gerou um único commit.

## Stress: interface real e renderização limitada

Playwright testa dados reais no SQLite isolado, invalidação equivalente a `jobs.changed`, página estabilizada antes do clique independente e trace sem snapshots durante o passe cronometrado. O trace inicial com snapshots adicionou overhead, preservado em `ui-stress-instrumentation-overhead.zip`.

| Jobs carregados | Linhas no DOM | Mount | Buscar | Detalhes | Paginação |
|---:|---:|---:|---:|---:|---:|
| 100 | 25 | 115,52 ms | 163,07 ms | 99,45 ms | 344,02 ms |
| 500 | 25 | 133,83 ms | 121,25 ms | 116,55 ms | 376,16 ms |
| 1.000 | 25 | 134,95 ms | 111,26 ms | 117,58 ms | 370,10 ms |
| 5.000 | 25 | 135,16 ms | 164,47 ms | 68,18 ms | 412,38 ms |

Essa tabela é o último passe de produção após as correções de Collapsible e paginação do Diagnóstico, registrado em `ui-stress.json`. Não extrapolar uma execução para p95 estatístico. Filtros tiveram paint opportunity entre 43,40 e 57,90 ms nesse passe; expansão do Collapsible, 5,60 ms. Limites automatizados: navegação/busca/detalhes/paginação <500 ms; filtro e expansão de Collapsible <200 ms. Seleção, composição, revisão e agendamento também têm tempos verificáveis em `publishing-ui-timings.json`.

## Inventário de atividade recorrente

### Diagnóstico com histórico cheio — regressão adicional comprovada

O profile coletado durante o soak registrou Diagnóstico com render máximo 1.129 ms e p95 403,5 ms. O painel montava grupos e detalhes fechados de milhares de eventos e serializava a busca vazia. Reprodução com 2.000 eventos no main real: abertura 938,14 ms, busca 1.137,48 ms e 26.107 nós.

Paginação de 25 grupos, detalhes somente ao expandir e 25 ocorrências por página reduziram para abertura 122,37 ms, busca 68,23 ms e 388 nós. Captura/exportação continuam com todos os eventos; pesquisa navega para o grupo e ocorrência antigos. O teste novo verificou tanto 2.000 grupos quanto um grupo com 2.000 ocorrências. Os números são tempos de parede até estado/frames verificáveis; não se apresentam como `actualDuration` React. Antes/depois: `diagnostics-before.json` e `diagnostics-after.json`.

| Origem | Frequência/condição | Payload/custo observado ou consulta |
|---|---|---|
| Workspace bootstrap | 10 s | workspace/settings; pequeno |
| Mascot jobs | 5 s | lista limitada de jobs; consulta distinta do resumo |
| Mascot/footer resumo | 5 s, chave compartilhada | página de dez jobs; oito SQL após batching |
| Notifications e achievements | 5 s | chave compartilhada com página correspondente quando igual |
| Diagnostic snapshot | 2 s | eventos até 2.000 e informação de falhas; permanece para footer |
| Diagnostic pipeline | 5 s, somente aberto/processador | métricas do pipeline; antes executava fechado |
| Diagnostic queue | 5 s, somente aberto/Fila | até 100 jobs; antes executava fechado |
| Queue dados | 5 s, página montada | página 25; oito SQL |
| Queue health | 2 s, página montada | contagens e estado de worker |
| Queue details | 5 s, detalhes abertos | chave compartilhada; dados de um job |
| Queue relógio | 1 s, página montada | estado local, sem SQL; clearInterval no unmount |
| Biblioteca grid | 3 s, página montada | até 60 mídias; gargalo correlacionado corrigido |
| Biblioteca pending | 2 s, página montada | até 100 pendências |
| Profiles import progress | condicional, enquanto importação | polling de progresso; desligado ao terminar |
| Settings updates | 1,5 s, painel montado | status de updater, sem busca de mídia |
| Webhooks | 5 s, modal aberto | histórico do workspace |
| DeliveryTime relógio | 30 s, montado | estado local; clearInterval no unmount |
| Worker health | 2 s | mensagem utility→main; não heartbeat de cada job |
| Worker recovery | 15 s | recuperação de lease expirada |
| Worker loops ociosos | espera de 1 s por loop | claim SQL; CPU utility medida baixa |
| Heartbeat de job | lease/3, durante execução | update com fencing; timer liberado |
| Provider poll | defer persistido de 15 s | libera execução e retoma com nova lease |
| Reminders | 30 s | verificações de lembrete |
| Supervisor restart | backoff 1–30 s, somente saída inesperada | timeout único; stop cancela |
| Media tool timeout | limite do job; probe 60 s | timeout único, limpo ao close/error |

Subscriptions relevantes: `jobs.changed`, `app.navigate`, `app.visibility`; evento de foco da Fila; resize e drag do Diagnóstico; listeners de pointer/blur/visibility/media-query do mascote; React Query focus/online. O preload devolve unsubscribe idempotente; a contagem de IPC é exposta somente no build de profiling. O inventário distingue custo medido de frequência lida no código; não existe benchmark de cada payload isoladamente.

## Memória e listeners: sessão de 30 minutos

Sequência Biblioteca→Perfis→Criar postagem→Fila→abre/fecha Diagnóstico→Biblioteca; 79 ciclos em 1.820.752 ms, snapshots completos com coleta de lixo.

- IPC antes/depois: `app.visibility=2`, `app.navigate=2`, `jobs.changed=3`.
- Document listeners: 5→5.
- Window listeners: 13 na primeira observação; 26 nos ciclos iniciais; 24 no final. Não houve crescimento acumulativo por ciclo. Os estados de montagem inicial diferem, portanto não se declara igualdade absoluta antes/depois.
- DOM detached: 35→35 nos snapshots.
- Heap JS: 13,46→19,18 MiB no snapshot final. Nos últimos ciclos, após GC, aproximadamente 17,33 MiB; não uma linha monotonamente crescente.
- Comparação de shallow heap: +4,84 MB, incluindo aproximadamente 0,94 MB de InstructionStream/JIT; mais objetos de diagnóstico, nomes de IPC perto do limite de 2.000 eventos, PerformanceEventTiming e instrumentação. Uma segunda conexão CDP adicionou outro script injetado Playwright de aproximadamente 321 KB e é parte da retenção observada.

`heap-comparison.json` contém deltas por tipo/nome. A análise de contagens/shallow sizes não fornece dominator tree ou retained size por objeto; não é prova de que todos os objetos adicionais são benignos. Não foi detectado aumento de DOM detached ou de IPC listeners nessa sessão. O soak ocorreu antes das últimas alterações CSS, índices e conteúdo do Collapsible; estas receberam testes próprios e 50 remounts, mas não um novo soak integral de 30 minutos. Essa cobertura é explicitamente limitada.

No teste posterior `remount-stable`, após aquecer um ciclo completo de refetch, 50 entradas/saídas da Fila mantiveram Document 5→5, Window 13→13, IPC 2/2/3→2/2/3 e dez intervalos ativos→dez, com as mesmas frequências. Heap após GC 11,27→13,15 MiB; inclui caches/diagnóstico e instrumentação. A primeira comparação sem aquecimento mostrou 2→10 intervalos porque timers de observers inicialmente existentes passaram a ser capturados nos refetches; o passe aquecido foi executado para distinguir isso de acúmulo. O teste de remount antecede a última paginação do Diagnóstico.

O passe completo `final-clean-retry`, sem profiler main, registrou médias sustentadas main 0,194%, GPU 0,243%, renderer 0,351% e utility 0,0237%. Diferiu do passe `final` e coincidiu parcialmente com testes/uso de outras janelas; ambos os valores são preservados. Não se escolhe apenas o melhor passe para afirmar um SLA de CPU.

## SQLite WAL e locks

Banco real: WAL habilitado. Observação de tamanho depende das conexões abertas; o arquivo foi zero após encerramento do app e 4.152 bytes em observação posterior. Isso não é uma medida de ausência de contenção em execução.

Experimento isolado: 1.000 updates dentro de uma transação, 6,54 ms; WAL 4.152 bytes; checkpoint PASSIVE busy=0, log=1, checkpointed=1, 1,65 ms. Um writer concorrente injetado produziu `SQLITE_BUSY` após 69,84 ms com timeout configurado 20 ms (tempo de parede inclui agendamento). O teste confirma recuperação posterior, não um SLA de locks reais. [wal.json](benchmarks/regression/wal.json).

Não se identificou no trace uma falha real de heartbeat por lock nem rejeição silenciosa de lease atual. Transaction/lock waits reais de toda a publicação não foram instrumentados separadamente.

## Critério de encerramento

Os gargalos medidos receberam correções específicas e evidências antes/depois. Publicação real e agendamento funcionaram nos cenários executados. Não se declara ausência universal de bloqueio de UI: long tasks permanecem, alguns p95 ultrapassam 100 ms e há cobertura incompleta de spans, retained-object paths, utility/FFmpeg profiling e crash abrupto durante resposta HTTP ambígua. O reinício externo gracioso após checkpoint passou. Esses limites impedem afirmar que todos os critérios solicitados estão integralmente certificados.
