# QA de regressão — 7 de outubro de 2026

## Execuções

`npm test -- --maxWorkers=2`: **90 arquivos passaram, 516 testes passaram, três testes ignorados**, última execução 86,66 s, após a paginação final do Diagnóstico. Três arquivos também foram ignorados. A execução anterior com concorrência default também passou, mas produziu avisos de timeout ao encerrar alguns forks; a execução com dois workers encerrou sem esses avisos. Não confundir avisos do runner com prova de vazamento do aplicativo.

`npm run typecheck`: passou. O primeiro check após incluir um teste acessando `$client` falhou por tipagem; o teste foi ajustado para usar `db.all`, reexecutado e passou.

Playwright, Electron real, um worker: **seis testes passaram em 41,8 s**, após corrigir um seletor de conta que também encontrava o mesmo username na Sidebar:

- `diagnostics.spec.ts`: painel, busca, rede, Fila, resize, navegação, exportação.
- `pipeline-jit.spec.ts`: destinos multi-account, intenção via IPC real, nenhuma edição antecipada.
- `publishing-ui.spec.ts`: contas, mídia, composição, capa, calendário, revisão, agendamento e Fila persistida.
- `queue-operations.spec.ts`: detalhes, operações em massa, filtros e layout menor.
- `regression-performance.spec.ts`: navegação, filtros, busca, detalhes e paginação com 100/500/1.000/5.000 jobs e thresholds.
- `diagnostics-performance.spec.ts`: 2.000 eventos no coletor real, paginação limitada, busca de evento antigo e de ocorrência antiga dentro de grupo com 2.000 ocorrências.

Dois problemas do harness foram corrigidos: o nome acessível do botão de fechar detalhes e uma captura PNG que falhava com `UNKNOWN` ao sobrescrever o arquivo antigo. A captura passou a usar a pasta de resultados do teste. Não foram classificados como regressão do produto.

## Matriz funcional e natureza da evidência

| Cenário | Resultado | Ambiente/evidência |
|---|---|---|
| Publicar um reel | CONFIRMED | Conta real @365jonvlogs; Meta HTTP 200; um histórico |
| Publicar três reels | Passou em conta real | Três CONFIRMED, 15 HTTP 200, três históricos; matriz controlada adicional |
| Agendar dez reels | Passou | `scheduleComposition` real; zero claim antes do horário; dez conclusões com clock controlado |
| Agendar pela interface | Passou | Electron/IPC/SQLite reais, credenciais sintéticas, horário futuro |
| Cancelar / reagendar / prioridade | Passou | Serviço real e E2E de operações |
| Retry manual | Passou | Testes de fila/resiliência preservam checkpoint/container |
| Falha FFmpeg | Reproduzida e corrigida | Execução real com vídeo/capa fracionários; teste decode/probe |
| Falha API definitiva | Passou | Erros controlados 401/code190 e permissão; falha permanente |
| 429 | Passou | Retry-After/cooldown A; B continua; classificação corrigida |
| 500/503 | Passou | Erros controlados; retry/checkpoint preservado; não `invalid_input` |
| Timeout na criação | Passou | Erro injetado; criação ambígua não reenviada automaticamente |
| Resposta perdida no publish | Passou | Reconciliação do mesmo container; nenhum segundo POST publish |
| Restart durante job | Passou em conta real e modelo controlado | Reinício gracioso em PROVIDER_PROCESSING; mesmo container, um POST create/publish, um histórico; lease expirada/recover controlado adicional |
| Persistência da publicação real | Passou | Leitura SQLite após encerramento do processo confirmou done/CONFIRMED e histórico único |
| Stress e paginação | Passou | Máximo 25 linhas renderizadas; thresholds na interface real |

Foram cinco posts externos: um com capa, lote de três e um com reinício real. Não houve queda de energia ou kill no meio de resposta HTTP ambígua; o teste externo reiniciou graciosamente após checkpoint e defer. A falha original observada ocorreu antes de qualquer HTTP Meta. Evidências externas: `live-batch-*` e `live-restart-*`.

## Elegibilidade, claims e capacidade

Consulta inicial direta no banco real: `state='queued' AND run_at<=agora` encontrou zero; o banco também não tinha jobs running ou cooldowns. Não havia jobs elegíveis ignorados nessa observação.

Nos testes `regression-qa.test.ts`, cada cenário avança o relógio até todos os horários previstos; o scheduler real executa os jobs. Contam-se IDs únicos e também número total de claims, pois os polls persistidos e a liberação por backpressure geram novas leases legitimamente.

| Jobs | Elegíveis | Encontrados/intencões | IDs únicos claimed | Concluídos |
|---:|---:|---:|---:|---:|
| 1 | 1 | 1 | 1 | 1 |
| 2 | 2 | 2 | 2 | 2 |
| 3 | 3 | 3 | 3 | 3 |
| 5 | 5 | 5 | 5 | 5 |
| 10 | 10 | 10 | 10 | 10 |

Foram verificados limite de conta, cooldown, jobs futuros, retorno da capacidade após defer, tentativas não consumidas por polling e ausência de POST de criação duplicado. Semáforo isolado com 1/2/5 usuários registra acquire/release e retorna a zero após sucesso e falha. Isso não fornece um log de aquisição/liberação de **cada** semáforo da publicação externa; a cobertura direta é limitada ao teste controlado e ao progresso real observado. [qa-capacity.json](benchmarks/regression/qa-capacity.json).

## Fencing e credenciais

Logs sob `LEGACY_PERF_DEBUG=1` registram jobId, workerId por PID, expected/actual lease, operação e aceite/rejeição. Após recovery, quatro operações da lease antiga foram rejeitadas; heartbeat e complete atuais foram aceitos. Checkpoint dos cenários 1/2/3/5/10 foi aceito. Os logs são provenientes dos testes com banco real, não do primeiro teste externo.

Teste novo em `instagram-publishing.test.ts`: duas contas, agendamento explícito, troca do default e resolução pelo snapshot de secrets do worker. Todas as chamadas receberam a credencial do destino. Nenhum token real consta das evidências. Não foi reproduzido token undefined/null ou fallback acidental para outra conta.

## Cache e mídia

`pipeline-resilience.test.ts` executa FFmpeg real para cache: derivação concorrente deduplicada, hit persistido, saída corrompida reconstruída, outra receita produz outro cache e original permanece byte a byte igual. Há três misses esperados e um hit no cenário, não um loop infinito. [cache.json](benchmarks/regression/cache.json) registra hash/read e probe; CPU/RAM do FFmpeg da publicação externa não foi amostrada com resolução suficiente para produzir um pico confiável.

## Interações medidas

Tempos incluem automação até estado verificável, separados de pointerdown→oportunidade de paint no stress. Os últimos valores estão em [publishing-ui-timings.json](benchmarks/regression/publishing-ui-timings.json), com limites de 500 ms. Em um passe anterior: abrir conta 214,61 ms; selecionar vídeo 45,50 ms; abrir composição 94,58 ms; revisar lote 83,70 ms; agendar e abrir Fila 157,18 ms. O modal ultrapassou o alerta de interação simples de 200 ms; o número não isola handler/IPC/paint.

Console com 2.000 eventos: abrir 938,14→122,37 ms; buscar 1.137,48→68,23 ms; linhas 2.000→25. Um grupo com 2.000 ocorrências mantém somente 25 detalhes no DOM e encontra ocorrências antigas. Teste de performance novo e integração passaram.

O stress registra long tasks, perfis React, CPU/RAM por processo e trace. Um trace inicial com screenshots/snapshots adicionou overhead relevante por ação; o trace de falha foi preservado e o passe cronometrado mantém tracing de API sem snapshots de DOM. A aplicação não recebeu spinners para mascarar tempos.

## Pendências de certificação

- Registrar separadamente pointerdown→handler→IPC→main→DB/API→resposta→React→paint para todas as ações solicitadas, incluindo perfil e Collapsible. Os tempos atuais de UI/IPC/SQL/render não são um único trace distribuído completo.
- Medir duração do commit React com tooling próprio; `actualDuration` é render, `commitTime` é timestamp.
- Amostrar FFmpeg e perfil de CPU do utility com resolução própria, não somente CPU/RAM periódicas de Electron.
- Validar crash abrupto durante respostas HTTP ambíguas; o reinício externo gracioso e o lote de três passaram.
- Não afirmar ausência universal de long tasks, listener leak ou contenção com base em testes de duração/cenários limitados.

O soak de 30 minutos e a medição final de repouso são registrados em [performance-regression.md](performance-regression.md), com resultados finais e limites de interpretação.

## Pacote de produção

Instalador local: `dist/Legacy-Setup-0.7.5-regression-audit.exe`, 207.516.464 bytes. SHA256: `957BB0E6B22CC3D0F07A09A52070F15814C6E8DAA88713D374AFF790143AF6BB`. Gerado sem publicação remota e sem substituir automaticamente a instalação existente.

O executável final `dist/win-unpacked/Legacy.exe` foi lançado com perfil vazio isolado: login visitante, Biblioteca, Perfis, Criar postagem e Fila passaram. SQLite nativo carregou os índices da migração; processos Browser, GPU, Utility e Tab estavam presentes. Instrumentação de debug no preload estava desativada. Nenhuma postagem externa foi criada nesse smoke. [packaged-smoke.json](benchmarks/regression/packaged-smoke.json).
