# Arquitetura

## Visão geral

```
Renderer (React)  ──IPC tipado (contextBridge + zod)──►  Main process
 src/renderer/**       src/preload/index.ts                 src/main/index.ts
                       src/shared/ipc-contract.ts           ├─ ipc/dispatcher.ts, ipc/handlers.ts (valida, escopo de workspace)
                                                            ├─ services/ (library, grid, metrics-import, export-tiktok, onboarding)
                                                            ├─ repos/ (workspaces, assets, profiles, remote-posts, covers, notifications, settings)
                                                            ├─ db/ (SQLite + Drizzle, migrations)
                                                            ├─ tray.ts, reminders.ts, media-protocol.ts
                                                            └─ supervisor.ts ► Worker (utilityProcess)
                                                                              src/main/worker/worker.ts, handlers.ts
                                                                              ├─ queue/queue.ts (lease, heartbeat, retry)
                                                                              └─ media/ (ffmpeg-bin, run, probe, validate, ops, encoders)
Broker (Cloudflare)  ◄── fase B, ainda não existe
```

O renderer não tem Node. Tudo passa pelo contrato em `src/shared/ipc-contract.ts` (canais, entradas zod, saídas). O preload expõe `window.legacy` com `invoke`, eventos e `pathForFile`.

## Fluxo de um job

1. Um caso de uso (por exemplo `library.importFiles`) grava a linha de domínio e chama `enqueue` na mesma transação, com `idempotency_key`.
2. O worker chama `leaseNext` (transação IMMEDIATE): pega o job com `run_at` vencido, incrementa `attempts`, define `lease_until`.
3. O handler em `worker/handlers.ts` roda (probe, miniatura, capa, banner, export) e renova o lease por heartbeat.
4. Sucesso: `complete` (retorna boolean; chamada com lease obsoleto é no-op). Falha: `fail` com backoff exponencial e jitter até `max_attempts`; resultado `stale` se o lease já foi perdido.
5. O worker envia um evento ao main (`WorkerEvent`), que cria notificações e repassa ao renderer.
6. O renderer invalida as queries do TanStack Query ligadas ao evento (biblioteca, fila, notificações) e a tela atualiza. Há também refetch de 10 s na fila e na barra de status.
7. Ao reiniciar, `recoverExpired` devolve à fila os jobs com lease vencido (ou marca `failed` se esgotaram as tentativas). O supervisor reinicia o worker com backoff.

## Por que os casos de uso não importam `electron`

Serviços, repositórios, fila e mídia são TypeScript puro sobre `better-sqlite3` e `child_process`. Assim rodam nos testes do Vitest (sob Electron apenas por causa do ABI nativo) sem simular janelas, e rodam idênticos no worker (`utilityProcess`). Só `index.ts`, `ipc/`, `tray.ts` e `supervisor.ts` tocam a API do Electron.

## Dados

Pasta de dados: `%APPDATA%/Legacy` ou `LEGACY_DATA_DIR`. `legacy.sqlite` (WAL) na raiz; mídia por workspace em `workspaces/<id>/`. O original importado nunca é alterado; derivados viram `media_versions`. As migrations são copiadas para `resources/migrations` no instalador.
# Extensão de downloads e armazenamento (2026-10-05)

`services/profile-download.ts` coordena `fetch_profile` e `download_reel` na fila existente. `services/download-http.ts` implementa transporte HTTPS restrito com DNS fixado, streaming e limites. O renderer usa os canais validados `profiles.downloadStatus` e `profiles.download`; credenciais não atravessam IPC. Assets de terceiros têm origem `ig_third_party` e posts apontam para o arquivo importado.

`services/storage.ts` persiste a pasta de novos vídeos por workspace. `storedAssetDir` resolve derivados a partir do caminho registrado de cada asset. Os canais `storage.get/choose/reset` expõem consulta, diálogo nativo e restauração do padrão. Arquivos existentes não são movidos; protocolo de mídia permite seus diretórios registrados.
# Incremento 0.2.0

`dashboard.ts` agrega estado operacional e cobertura de métricas; `integrations.ts` define credenciais, preferências e configuração. O main implementa a interface SecretVault usando safeStorage, sem import de Electron nos serviços. O supervisor encaminha snapshots de segredos ao worker por mensagens internas.

`webhooks.ts` registra um outbox na fila de jobs, na transação de conclusão/falha da tarefa de origem. Jobs `webhook_delivery` não produzem novos webhooks. Preferências controlam notificações da aplicação; `reminders.ts` agrupa alertas nativos por workspace.

`TutorialProvider` gerencia tours com Radix Dialog e destaques em data-tour. `TutorialPage` oferece plano salvo e referências. `CaptionRibbon` é reutilizado no editor, nos perfis e no guia; o serviço `captions.ts` ordena somente legendas com a métrica escolhida presente.
