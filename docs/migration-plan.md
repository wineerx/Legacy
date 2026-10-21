# Migração e validação operacional

## Aplicação desta mudança

1. Preservar backup de legacy.sqlite com procedimento de backup SQLite, e do diretório de mídia; fechar o app para atualização. Não foi alterado banco do usuário durante a auditoria.
2. Migração 0005 adiciona registro de destinos, limites persistidos, lease_version e índices de conta/lote/leases/tentativas.
3. Migração 0006 adiciona prioridade tipada e índice de claim com ordenação; migra prioridades existentes de settings e adiciona índices globais type/state e timestamps de tentativas.
4. A migração de receitas no startup converte apenas apply_banner queued referenciado por publish_instagram queued. Mantém versionId, arquivos PNG, payload de publicação e checkpoints; cancela o job de edição antecipada. Jobs em execução e edições manuais independentes são preservados.
5. Contas antigas continuam utilizáveis; conectar outra importa o destino/token anterior para o registro antes de mudar a seleção default. Não copiar token de A para namespace B.
6. Executar piloto com 1 FFmpeg, 2 slots, 2 exposições e 1 publicação em execução por conta. Usar diagnósticos e observar lag/leases/cooldowns e armazenamento antes de ampliar concorrência.

Backpressure é persistido em SQLite: milhares de intenções não iniciam milhares de processos. Fechar/reabrir recupera leases expiradas; confirmação em provider continua usando checkpoint anterior. Requeue não redireciona conta nem zera resultado remoto.

## Rollback

Parar workers antes de rollback. Versão antiga não entende receitas JIT e não deve consumir estes jobs; retomar snapshot de banco+arquivos de antes da migração ou manter fila pausada e executar conversão explícita de receitas. Não apagar jobs/containers nem publicar novamente para fazer rollback. Manter compatibilidade de leitura dos checkpoints antigos é obrigatório. Snapshot Drizzle 0006 acompanha schema final; 0005/0006 são migrations manuais auditadas.

## Matriz de cobertura da solicitação

| Área | Entregue nesta alteração | Limite ainda existente |
|---|---|---|
| Mapeamento/baseline | Documentos prévios, SQLite/FFmpeg reais e dados brutos | Fixture curta; não é workload do usuário |
| JIT e isolamento | Receitas, media semaphore, tentativas curtas, batch lógico | Renderização/extrair PNGs ainda na ação do compositor; exportação TikTok é job de lote manual |
| Idempotência/claim | Lease fencing, checkpoints, histórico único, revisão de POST ambíguo | Sem garantia transacional externa |
| Multi-account | Registro e credenciais Instagram por destino, seleção UI, batch explícito via IPC | TikTok Direct Post/OAuth ausentes; compositor seleciona um destino por ação |
| Auth | safeStorage e namespaces; desconectar/reconectar isolados | Refresh automático, expiração e catálogo de permissões não implementados |
| Limiter | Concorrência, Retry-After, backoff+jitter, cooldown/circuit persistidos | Quotas/headers de uso e token bucket oficial dependem de validação Meta v25 |
| DLQ/stalled | Failed acessível, lease monotônica, recuperação periódica | Não é broker distribuído |
| Cache/storage | Hash de configuração/output, validação, TTL startup, originais preservados | TTL/LRU por bytes contínuo e PNGs órfãos pendentes |
| DB | Índices de claim/conta/lote/leases/tentativas, claim IMMEDIATE | N+1 na página de fila e detalhes permanece identificado |
| Observabilidade | Correlation traceId/jobId/batchId/media/account, health e percentis no painel | Eventos são buffer em memória de 2000, não tracing persistente distribuído; CPU/I/O por worker não são métricas contínuas |
| Benchmarks | 1–200 jobs, 1/3/5/10 destinos, 200 por conta, FFmpeg 1/2/4/8 | Performance externa, rede real e carga confortável de produção não certificadas |
| Falhas | Resposta perdida create/publish, 429, 500 GET, fencing, cache corrupto, DLQ, pausa/restart | Falha Redis não aplicável; DB lento/internet/tokens de produção não induzidos globalmente no computador |

## Critérios de liberação que ainda exigem ambiente externo

Validar quotas/content_publishing_limit, covers e headers na referência oficial da versão, com permissões e sandbox apropriados. Medir vídeos reais 1080p/VFR e tráfego do host. Certificar refresh OAuth por conta e Direct Post TikTok com creator info, consentimento e auditoria do cliente. Medir os percentis de download externo, processamento e confirmação; não extrapolar o mock de 1 ms para jobs/h reais. Certificar kill abrupto durante upload com provider sandbox, DB lento em processo separado, longa permanência de fila e lifecycle por bytes.

A pasta docs/qa/audit-schema contém saída auxiliar do gerador Drizzle. A revisão automática bloqueou sua remoção; não aplicar o SQL inicial dessa pasta a um banco existente. Usar somente src/main/db/migrations.
