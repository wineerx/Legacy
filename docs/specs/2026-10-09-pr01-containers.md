# PR 01 — Fundação de Containers de publicação

Data: 2026-10-09. Status: especificação aprovada pelo usuário e implementada no checkout. Consulte [implementação e validação](../pr01-containers.md) para os contratos finais, compatibilidade e evidências.

Problema: hoje o lote existe como batchId no payload de jobs. Isso não permite guardar um rascunho com ordem/configuração, editar com revisão, distinguir plano de execução ou obter uma unidade estável para Agenda e Fila. O PR cria essa entidade, preservando jobs independentes, leases e checkpoints existentes.

## Escopo e limites

Entregar schema/migration, repositório, serviço, contratos IPC, resumo paginado e integração dos agendamentos Instagram existentes. Incluir controle de pausa/retomada/cancelamento com semântica segura no claim. As telas atuais continuam agendando, mas passam a criar Containers reais de modo atômico.

Ficam nos próximos PRs: novas telas, seleção/reordenação visual, watermark, editor de templates, consulta oficial de quota, janelas inteligentes, política de atraso, calendário/drag & drop e TikTok Direct Post. Persistir a fundação de legenda e snapshot visual sem ampliar o editor atual.

Um Container agendado contém 1–1.000 vídeos, uma conta Instagram e uma plataforma. A capacidade de 1.000 vem do contrato técnico publications.schedule; não é promessa de quota ou velocidade. Adaptadores atuais mantêm seus limites de 100 itens até ampliação explícita. Rascunho pode estar vazio e sem conta/início; o agendamento exige todas as informações válidas.

## Modelo proposto

```text
PublicationContainer (unidade Legacy)
  ├─ workspace / identidade / revisão
  ├─ destino Instagram / revisão da conta
  ├─ plano UTC + fuso IANA + intervalo
  ├─ legenda base / snapshot visual
  ├─ controle ativo | pausado | cancelado
  └─ itens ordenados
       ├─ asset / procedência
       ├─ legenda herdada ou override
       ├─ horário planejado / snapshot efetivo
       └─ job independente → checkpoint Meta → confirmação
```

### publication_containers

| Campo | Semântica |
| --- | --- |
| id, workspace_id | UUID e escopo; UNIQUE(workspace_id, id) para referências compostas |
| name | Nome editável, 1–120 caracteres; não usar número sequencial como identidade |
| provider, destination_account_id | Par do destino; nulo somente no rascunho incompleto; PR 01 aceita Instagram |
| account_revision | Revisão capturada ao agendar; não contém credencial |
| time_zone | Fuso IANA do plano, inicialmente copiado do workspace |
| planned_start_at, planned_end_at | UTC; fim = último envio planejado, não garantia de confirmação |
| interval_min | Intervalo inteiro; mínimo atual de 15 min, máximo 10.080; não é quota oficial |
| caption_base | Texto base, até 2.200 caracteres no PR 01 |
| visual_snapshot_json | Configuração versionada das receitas existentes, sem tokens nem bytes de vídeos; formato validado |
| scheduled_at | Nulo no rascunho; preenchido no agendamento atômico |
| control_state | active, paused ou cancelled; separado do estado operacional derivado |
| revision | Inteiro crescente nas mutações explícitas; compare-and-swap para edição obsoleta |
| created_at, updated_at | UTC do registro |

Destino referencia (workspace_id, provider, provider_id) de destination_accounts; excluir conta referenciada é bloqueado, desconectar mantém a linha. Validar campos incompletos de rascunho no serviço e usar constraints para invariantes estruturais.

### publication_container_items

| Campo | Semântica |
| --- | --- |
| id, workspace_id, container_id | UUID e FK composta para Container do mesmo workspace |
| position | Inteiro a partir de 0; UNIQUE(workspace_id, container_id, position) |
| asset_id | FK composta para mídia do mesmo workspace; pode virar null após remoção permitida, conservando snapshot |
| source_snapshot_json | Nome, hash e procedência necessários ao histórico; não é uma cópia mutável do perfil |
| caption_override | null herda base; string vazia é personalização deliberadamente vazia |
| planned_publish_at | UTC do envio planejado, fixado ao agendar |
| recipe_version_id | Receita/versão validada para a mídia e workspace; não executar FFmpeg ao criar rascunho |
| effective_snapshot_json | Legenda final, receita, shareToFeed e consentimento de repostagem capturados no agendamento |
| job_id | Nulo no rascunho; UNIQUE e referência ao job do mesmo workspace quando agendado |
| created_at, updated_at | UTC |

Para FKs compostas, adicionar chaves UNIQUE(workspace_id, id) em media_assets e jobs, sem reconstruir dados desnecessariamente. Não fazer cascade que apague Container/histórico ao excluir mídia ou job. Serviços de exclusão precisam proteger mídia usada por rascunhos; oferecer remoção do rascunho primeiro. Itens agendados conservam identidade/hash/procedência mesmo quando a cópia local é removida por ação permitida após término.

Índices: Containers por workspace/created_at/id e workspace/planned_start_at/id; itens por workspace/container/position, workspace/asset e job_id. O claim deve localizar a associação job→item→Container por índices, sem varrer todos os payloads. Não persistir contadores duplicados nesta fundação.

### Resumo calculado

Retornar total, publicados confirmados, pendentes, executando, falhas terminais, cancelados, itens com operação remota em aberto, espera por quota, início real e última confirmação. Usar agregações do lote inteiro, não itens da página. Job done sozinho não inventa confirmação: publicados exige ledger/checkpoint de confirmação conforme o fluxo existente.

`plannedDurationMin = (N - 1) × intervalMin` para N ≥ 1. Doze envios a partir de 13:00, a cada 15 min, têm último envio às 15:45 e duração planejada de 165 min. Um vídeo tem duração planejada zero. A duração do arquivo é outra grandeza.

`estimatedEndAt` e `delayMin` são nullable nesta entrega. Não usar max(run_at) indiscriminadamente: o campo também indica polling/backoff. Retomada estimada por quota pode ser apresentada com fonte e marca de estimativa; previsão completa de término é trabalho do PR 07. Quota prevista neste PR é a demanda de N publicações; quota disponível/total permanece null quando desconhecida.

## Estados e precedência

Os sete estados do pedido são uma projeção calculada, combinando controle persistido, presença de plano e estado dos itens. A projeção deve ser uma função compartilhada/determinística, sem jobs com novo state.

| Estado UI / domínio | Regra |
| --- | --- |
| Rascunho / draft | scheduled_at nulo e controle não cancelado; zero jobs |
| Cancelado / cancelled | control_state cancelled; manter contagens e eventual confirmação em trânsito |
| Concluído / completed | Todos os itens confirmados |
| Concluído com falhas / completed_with_failures | Todos os itens terminais, ao menos um não confirmado; detalhar falha/cancelamento individual |
| Pausado / paused | Não terminal e control_state paused |
| Em andamento / in_progress | Não terminal, ativo, e existe item já iniciado/terminal/checkpoint remoto |
| Agendado / scheduled | Plano ativo, não terminal, sem item iniciado |

Precedência: cancelado → rascunho → conclusão total → pausa → andamento → agendado. Cancelamento individual de job pode produzir “concluído com falhas”; o resumo distingue cancelados de falhas técnicas. Retry/reagendamento de um item terminal pode reabrir completed_with_failures para in_progress; não retornar a draft nem apagar histórico. Container cancelado não aceita retry de novos envios sem uma nova intenção explícita.

WAITING_QUOTA é motivo operacional por item/conta e badge no resumo. Continua queued com checkpoint publicationLimit/provider_limits. Aguardar quota nunca conclui o Container com falhas e nunca consome o orçamento de tentativas. Um Container já iniciado pode estar em andamento e esperando quota ao mesmo tempo.

## Contratos IPC propostos

Todas as entradas validadas com Zod e workspace autenticado pelo dispatcher. Nenhum endpoint devolve token, payload bruto ou caminhos não necessários.

| Canal | Entrada principal | Resultado |
| --- | --- | --- |
| containers.create | workspaceId, requestId UUID, nome e campos opcionais de rascunho | ContainerDetail com revision |
| containers.updateDraft | workspaceId, containerId, expectedRevision, configuração e lista ordenada de itens | Detail; só rascunho |
| containers.get | workspaceId, containerId, página dos itens | Resumo integral + itens paginados |
| containers.query | workspaceId, página/tamanho e filtros validados | Página de resumos; filtros de estado aplicados antes da paginação |
| containers.schedule | workspaceId, containerId, expectedRevision | Container atualizado e JobView[] |
| containers.pause | workspaceId, containerId, expectedRevision | Resumo atualizado |
| containers.resume | workspaceId, containerId, expectedRevision | Resumo atualizado; preserva plano/horários/checkpoints |
| containers.cancel | workspaceId, containerId, expectedRevision | Resumo + quantidade ainda em reconciliação |

requestId deduplica criação por workspace; persistir chave específica UNIQUE(workspace_id, request_id), em vez de depender da janela do renderer. Mutação com revisão antiga retorna conflito legível. Repetição de schedule após resposta perdida devolve os mesmos jobs se o plano e a revisão de agendamento forem os mesmos; pedido diferente nunca reaproveita silenciosamente configuração anterior. Não usar expectedRevision de edição para invalidar retry idêntico depois do commit de schedule.

Não incluir delete em 01: cancelar conserva intenção e histórico. Não incluir reagendamento em massa: revisar impactos pertence ao Scheduler/Agenda. Adicionar/remover/reordenar itens é uma operação atômica de updateDraft, sem endpoint por linha nem loop IPC por vídeo.

## Agendamento e integração

1. Em transação IMMEDIATE, verificar workspace, revisão, estado draft e todos os itens.
2. Resolver conta conectada e revisão; conferir assets/receitas, legendas, intervalo e horizonte inteiro (mínimo atual: primeiro envio ≥ agora + 1 minuto; último ≤ agora + 90 dias).
3. Validar repostagem por destino e consentimento conforme serviço existente. Não capturar credencial em Container/job.
4. Calcular horários UTC, gravar snapshots efetivos e criar um publish_instagram por item na mesma transação.
5. Vincular job_id e preservar `payload.batchId = container.id` para compatibilidade com Fila/diagnóstico. Não usar containerId genérico no payload: já pode representar o contêiner remoto Meta em outros contextos.
6. Publicar eventos/invalidações somente após commit. Erro em qualquer validação reverte todos os jobs novos e mantém o rascunho.

Reusar as regras atuais de idempotência mídia/conta/horário e checkpoints, mas detectar conflito parcial: um job pertencente a outro Container não pode ser adotado como item novo. Uma tentativa repetida de agendar o mesmo Container retorna seus vínculos existentes. A criação de intenção equivalente em outro Container retorna conflito; não reassocia nem duplica job.

compose.scheduleInstagram e profiles.scheduleInstagram mantêm assinatura e retorno JobView[]: criar/agendar Container em uma única operação transacional, com legendas finais e ordem atuais. publications.schedule aceita batchId heterogêneo: preservar contrato e batchId de agrupamento técnico, particionar em Containers por conta/provider, com vínculo de grupo técnico explícito. Nesse adaptador, batchId não é necessariamente container.id; um campo validado `publicationContainerId` pode identificar a unidade Legacy se necessário. Grupo técnico não vira entidade de planejamento no PR 01. Repetir o mesmo batchId/intenção deve recuperar os mesmos Containers/jobs, inclusive se a resposta do primeiro commit se perder.

O adaptador do compositor recebe legendas já resolvidas; preservá-las como overrides na ausência de base explicitamente informada. Não tentar inferir a base pela repetição de texto. PRs 11–12 expõem a relação persistida sem alterar resultados antigos.

## Pausa, retomada e cancelamento

O claim atual é global e usa jobs queued também para polling. Implementar um gate por Container dentro da transação do claim, e revalidar antes de uma nova chamada externa mutante. A pausa global de sessão continua tendo precedência sobre a pausa de lote.

- Pausar: impede novas preparações/envios do lote ainda não iniciados; não mata FFmpeg/processo com lease em curso. Uma chamada já em trânsito pode ser aceita; a resposta explica operações em aberto.
- Checkpoint remoto existente: permitir consulta/reconciliação e eventual confirmação. Em pausa/cancelamento, não iniciar media_publish que ainda não foi enviado; consultar estado e preservar o contêiner pronto. Checkpoint de publish ambíguo/PUBLISHED deve continuar sendo reconciliado, sem segundo POST.
- Preparação iniciada antes da pausa pode terminar localmente; antes de criar mídia remota, verificar controle e adiar com checkpoint sem gastar tentativa. Nenhum gate revoga um lease para dar o mesmo job a outro worker.
- Retomar: preservar o intervalo e os horários já registrados; não planejar automaticamente uma nova janela. Se houver itens vencidos, informar essa condição e aplicar elegibilidade existente, quotas e concorrência. Ajuste inteligente fica no PR 07.
- Cancelar: cancelar itens sem operação remota em aberto; para contêiner remoto criado mas publish não enviado, marcar cancelado conservando checkpoint e limpar recursos locais conforme lifecycle existente. Para publish enviado/ambíguo, manter job elegível apenas para reconciliação, nunca novo envio; uma confirmação tardia entra no ledger e aparece no resumo cancelado.
- Retry/reagendamento individuais: respeitar gate do Container e revisão de destino. Em pausado, podem reparar a intenção, mas continuam bloqueados para novo envio; em cancelado, bloquear retry de envio e permitir apenas revisão de resultado remoto.

Definir a elegibilidade por etapas tipadas/checagem explícita dos checkpoints conhecidos; não por substring do JSON ou apenas state queued. Cobrir checkpoint legado creating/containerId/publishing/mediaId. Não substituir a política de ambiguidade existente. Caso seja impossível distinguir criação sem resposta, manter revisão manual, nunca um novo POST automático.

## Migração e compatibilidade

Migração aditiva seguinte à última registrada no checkout (atualmente 0007; confirmar numeração ao implementar). Adicionar tabelas/índices/chaves compostas e manter os campos atuais de jobs/history. Atualizar journal e snapshot Drizzle correspondente.

Não transformar automaticamente lotes antigos em Containers: batchId também aparece em downloads/exportações e pode reunir contas/horários irregulares. Jobs sem vínculo novo seguem o claim atual; a Fila continua agrupando-os como “Lote legado”. Adotar legado será operação explícita posterior, com validação da homogeneidade, sem reenfileirar nem modificar checkpoints/run_at. Não exigir pausa de todo o aplicativo para que jobs antigos continuem executando após migration.

Snapshot de nome/hash/procedência sobrevive à remoção permitida da mídia. Não converter exportação TikTok em publicação confirmada. Não reativar falhas antigas ao migrar.

Rollback: parar workers e restaurar backup consistente de banco/mídia se for necessário regressar ao binário anterior. Versão antiga ignora o gate novo e poderia executar jobs de Container pausado; não executar fila com binário antigo sobre esse banco. Preservar fonte/documentação e histórico, sem apagar jobs para “voltar”.

## Critérios de aceite e verificação

| Cenário | Resultado exigido |
| --- | --- |
| Rascunho vazio / incompleto | Persiste e pode ser editado; schedule rejeita sem criar jobs |
| 12 itens / 15 min / 13:00 | Ordem 0–11; último plano 15:45; 12 jobs independentes |
| Uma mídia/conta/receita inválida | Rollback integral; nenhum novo job parcial |
| Duplo clique / resposta de schedule perdida | Mesmo Container e mesmos jobs; conflito de configuração explícito |
| Job equivalente já em outro Container | Rejeição sem reassociar ou duplicar |
| Dois workspaces / contas | Consulta, vínculo, controle e credencial isolados; FKs negativas testadas |
| Um item falha | Próximos executam; falha terminal só encerra projeção quando não restam pendências |
| Quota na conta A | Espera sem tentativa/falha consumida; B continua; plano original preservado |
| Pausa durante preparação/polling/publish | Bloqueia novos envios; confirmação enviada segue segura; retomada sem replay |
| Cancelamento com publish em trânsito | Não inventa rollback remoto; confirmação tardia aparece no ledger/resumo |
| Reinício / lease obsoleta | Controle persiste, recuperação respeita gate, checkpoint não é sobrescrito |
| Legenda herdada / override vazio | Resultados distintos; snapshot estável após agendamento |
| Exclusão de asset em rascunho / após término | Rascunho protegido; histórico permanece após exclusão permitida |
| Resumo com 1.000 itens e página de 50 | Totais integrais, consulta agregada, sem N+1 por item |
| Mutation com expectedRevision antigo | Conflito explícito, sem alteração parcial |
| Migration em banco antigo | Jobs legados intactos, sem reenvio/reativação; schema novo válido |

Rodar typecheck, Vitest sob Electron (`npm test -- --maxWorkers=2`) e E2E pertinente dos adaptadores existentes com bancos temporários e rede simulada. Testar criação, agendamento, gates e recuperação em integração; testes de projeção cobrem todos os estados e precedências. Não criar novos E2E de telas inexistentes. Medir consultas de resumo/claim com 1.000 itens e registrar resultado, sem estabelecer SLA a partir de mocks de provider.

Divisão sugerida dentro do PR: (1) schema/migration/repos e integridade; (2) serviço/IPC/adaptadores e idempotência; (3) gates e reconciliação; (4) verificação e documentação. Se o gate exigir diff maior, dividir a entrega em PR 01a/01b, mantendo controles de pausa/cancelamento indisponíveis até a regra completa estar validada.

## Decisões propostas e fronteiras abertas

Decisões aprovadas ao autorizar a implementação: rótulo “Container”, domínio PublicationContainer; um destino por entidade; rascunho editável e plano congelado; estado derivado; adoção de legado posterior. As adaptações necessárias para preservar repostagens intencionais e contas antigas estão registradas no documento de implementação.

PR 07 decidirá política de atraso/itens vencidos, incluindo opções manter intervalo, reduzir intervalo ou mover restante. PR 05 decidirá fonte/cadência/validade da quota e reservas entre lotes. PR 04 decidirá revisões de templates e política de arquivos/snapshots. PR 16 depende de autenticação, elegibilidade e contratos TikTok. Esses pontos não justificam inventar valores oficiais nem implementar todas as features no PR 01.
