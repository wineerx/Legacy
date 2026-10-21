# Fundação de Containers — PR 01

Data: 2026-10-09. Implementação no checkout; nenhuma release, instalação ou publicação externa realizada.

O Legacy agora persiste `PublicationContainer` e itens ordenados. Cada Container tem uma conta/plataforma; cada item agendado continua sendo um job independente. Criar/agendar pelos fluxos existentes passa a registrar essa entidade, preservando receitas JIT, checkpoints, leases, histórico e proteção por quota. Não foram criadas telas nesta entrega.

## Persistência e contratos

Migration: `0008_flimsy_arachne.sql`, gerada com Drizzle, journal e snapshot 0008. Acrescenta `publication_containers`, `publication_container_items`, índices e FKs compostas por workspace. Não converte nem reativa jobs legados. Jobs sem vínculo continuam operando pelo caminho anterior.

Repositório: `src/main/repos/publication-containers.ts`. Serviço: `src/main/services/publication-containers.ts`. Contratos/DTOs: `src/shared/publication-containers.ts` e `src/shared/ipc-contract.ts`.

| Canal | Entrada | Saída |
| --- | --- | --- |
| containers.create | workspaceId, requestId UUID, draft | ContainerDetail |
| containers.updateDraft | workspaceId, containerId, expectedRevision, draft | ContainerDetail |
| containers.get | workspaceId, containerId, page/pageSize opcionais | ContainerDetail |
| containers.query | workspaceId, paginação, estado/conta opcionais | ContainerPage |
| containers.schedule | workspaceId, containerId, expectedRevision | detail + jobs |
| containers.pause | workspaceId, containerId, expectedRevision | ContainerDetail |
| containers.resume | workspaceId, containerId, expectedRevision | ContainerDetail |
| containers.cancel | workspaceId, containerId, expectedRevision | ContainerDetail após limpeza das exposições canceláveis |

`draft` é uma substituição integral da configuração/lista ao editar. Contém nome, plataforma/conta/revisão, início UTC, fuso IANA, intervalo, legenda base, snapshot visual v1 e itens ordenados com mídia, override de legenda, receita, shareToFeed e consentimento de repostagem. Rascunho vazio/incompleto é permitido; agendamento incompleto é recusado. O snapshot visual v1 nesta fundação não tem editor de watermark/template.

Override null herda a base; override vazio produz legenda vazia. A legenda final e a receita escolhida ficam registradas no snapshot efetivo de cada item. A edição do rascunho não gera FFmpeg nem jobs. Após agendamento, configuração e ordem são congeladas; futuras estratégias de alteração pertencem aos próximos PRs.

Criação deduplica requestId por workspace e compara configuração. Schedule registra a revisão da intenção agendada: repetir a chamada original após resposta perdida devolve os mesmos jobs, inclusive após o horário planejado. Intenção conflitante em outro Container/lote legado é recusada. Um erro em qualquer item reverte jobs, vínculos, snapshots e atualização de estado na mesma transação IMMEDIATE.

Os adaptadores `compose.scheduleInstagram` e `profiles.scheduleInstagram` conservam assinatura/retorno. `publications.schedule` conserva batchId técnico e ordem do resultado, particionando os destinos em Containers separados. Seus horários explícitos por item continuam autoritativos; em batches irregulares, o intervalo nominal do Container não substitui esses horários. Repetição deliberada da mesma mídia requer `allowRepost` no item repetido e não aceita a mesma intenção mídia/conta/horário duas vezes.

Para contas antigas armazenadas somente em settings, uma nova criação/agendamento registra a mesma identidade e copia o token já cifrado para o namespace daquela conta, dentro da transação. Não há OAuth, nova conexão externa ou troca de credencial. Os handlers atualizam o snapshot de segredos do worker após commit. Jobs/lotes antigos não são adotados nesse processo.

## Controle e reconciliação

`control_state` persiste active/paused/cancelled. Os sete estados do produto são projeções das contagens integrais, não novos states da fila. O filtro de estado é aplicado no SQL antes de paginar Containers; detalhes paginam itens, mas os totais sempre representam o Container inteiro. Publicados exige ledger de confirmação; job done isolado não inventa sucesso.

O gate consulta vínculo job→item→Container por índice. Pausa impede novas preparações/envios. Checkpoint remoto continua elegível para consulta de status. Antes de cada POST, o worker revalida controle e lease; uma operação que já atravessou essa fronteira pode terminar. FINISHED pausado mantém o mesmo contêiner Meta e bloqueia media_publish até retomada.

Cancelamento mantém checkpoints e histórico. Jobs sem operação remota iniciada ou com mídia remota preparada mas publish não enviado podem ser cancelados. Um publish enviado/ambíguo continua apenas em reconciliação e pode produzir confirmação tardia no ledger. Creating sem resposta mantém a proteção de revisão manual; não se faz novo POST. Retry/reschedule de novos envios em Container cancelado é recusado. Jobs legados preservam o comportamento de cancelamento anterior.

`ContainerHeld` é tratado pelo worker sem falha definitiva ou consumo de tentativas. Após crash/recovery, um job queued pertencente a Container cancelado e sem checkpoint remoto é encerrado como cancelled no próximo claim. Lease antiga não pode sobrescrever checkpoint nem concluir uma execução recuperada.

Retomar preserva plano, run_at, checkpoints e limite de conta. Não redistribui horários nem comprime intervalos. Itens vencidos seguem a elegibilidade já existente; planejamento inteligente e política de atraso continuam fora de 01. O fim planejado é o último envio, não a confirmação remota. EstimatedEndAt/delay/total de quota permanecem null onde não há informação confiável.

Mídia usada por rascunho ativo ou job pendente fica protegida nos serviços de exclusão. Após cancelamento/término, exclusão permitida desassocia asset_id mantendo nome/hash/procedência nos itens; não apaga Container ou histórico.

## Verificação

Testes específicos: `src/main/services/publication-containers.test.ts`. Cobrem rascunho/CRUD, revisão, horários, rollback posterior, resposta perdida, legendas, jobs independentes, quota por conta, gates durante preparação/status/publish, confirmação tardia, worker, reinício real de SQLite, fencing, FKs/workspaces, exclusão protegida, paginação, adaptadores, migração legada e os oito canais pelo dispatcher.

Electron E2E: `tests/e2e/pipeline-jit.spec.ts` agora exercita os oito canais pela bridge real, preservando a receita JIT sem arquivo derivado antecipado. `publishing-ui.spec.ts` e `queue-operations.spec.ts` verificam os fluxos existentes. Fixtures usam dados/credenciais sintéticos, APIs simuladas e banco temporário. Nenhum provider real recebeu publicação.

O ensaio de 1.000 itens verifica totais integrais com página de 50, criação de intenções e claim indexado. O registro de tempo está em [benchmarks/pr01-containers-2026-10-09.json](benchmarks/pr01-containers-2026-10-09.json). São operações locais com provider simulado; não medem velocidade de publicação real.

Comandos de validação:

```powershell
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npx playwright test tests/e2e/pipeline-jit.spec.ts tests/e2e/publishing-ui.spec.ts tests/e2e/queue-operations.spec.ts
```

Validação: typecheck e build aprovados; suíte completa com **560 testes passando em 93 arquivos**, com 3 benchmarks opt-in desativados; **3 E2E Electron passando**. Os 31 testes específicos da fundação cobrem os critérios acima. Ensaio separado de 1.000 itens: cadastro/agendamento ~2,11 s, consulta integral/página ~4 ms e claim ~3,43 ms neste ambiente. PRs 02–22 não foram iniciados.

## Atualização e rollback

Aplicar a migration pelo fluxo normal ao iniciar a nova versão, com backup consistente do SQLite e das mídias antes da atualização. Não executar a versão antiga sobre a fila nova: ela não conhece o gate de Container e pode consumir jobs pausados. Para rollback, parar workers e restaurar o backup compatível; não apagar/recriar jobs nem checkpoints. Esta implementação não alterou o banco da instalação do usuário.
