# Auditoria técnica — 2026-10-07

Baseline: árvore de trabalho atual, incluindo alterações anteriores não commitadas. Nenhum banco do usuário ou publicação real é usado nos ensaios.

| Risco | Evidência | Prioridade |
|---|---|---|
| Edição antecipada de lote | ComposePage chama versions.prepareVideo antes de schedule | P0 |
| Espera bloqueia todas as contas | publicationUntilTerminal + único worker serial | P0 |
| Retry de 429/5xx descartado | InstagramApiError invalid_input; publicação permanent incondicional | P0 |
| Credencial única por workspace | instagramAccount/instagramToken em settings | P0 |
| Escrita de worker obsoleto | heartbeat e save checkpoint sem attempts/lease | P0 |
| Timeout remoto ambíguo | creating/publishing persistidos; seguro contra replay, exige reconciliação | P1 |
| Original removido por cleanup | recordPublication → deleteAsset | P1 |
| Recuperação atrasada | maybeRecover apenas ocioso | P1 |
| Túneis perdidos no crash | registry em memória; startup sweep | P1 |
| Métricas/N+1 | queueContext por linha; médias e capacity hardcoded | P2 |

Os checkpoints já existentes são importantes: não trocar por retries cegos. Exactly-once externo não é demonstrável em POST sem chave idempotente do provider; após resposta perdida é necessário reconciliar ou manter estado ambíguo acessível. Uma criação ambígua nunca deve recriar automaticamente.

A versão usada é Instagram Login `graph.instagram.com/v25.0`. A documentação Meta direta esteve indisponível ao navegador da auditoria; coleção oficial Meta: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api . Não adotar quotas numéricas nem capa externa sem validar referência da versão e infraestrutura de exposição de imagem. TikTok possui video_cover_timestamp_ms e exige consentimento, creator info e auditoria do cliente: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post . Não confundir exportação manual existente com integração Direct Post.

Decisão inicial: manter SQLite e uma state machine durável no desktop; filas distribuídas/Redis adicionariam serviço e operação sem evidência que justifique. Separar slots e etapas no mesmo processo, deixando polling persistido liberar capacidade. Limites locais são proteção de recursos, não quotas oficiais.

## Resultado da intervenção

Implementados: receitas JIT, polling que libera slots, semáforos e backpressure, credenciais Instagram por destino, lote explícito por IPC, lease fencing monotônico, retries classificados, cooldown persistido, cache verificado por conteúdo, preservação de originais, migração de edições legadas e diagnósticos com health/percentis. A validação também encontrou e corrigiu o remount periódico do menu da fila.

[Arquitetura alvo](target-architecture.md), [state machine](queue-state-machine.md), [dados antes/depois](performance-results.md) e [matriz de cobertura e pendências](migration-plan.md) descrevem o que foi comprovado e o que ainda falta. Não declarar a solicitação inteira certificada em produção: Direct Post TikTok, OAuth refresh, quotas/headers oficiais da Meta, N+1 da interface, lifecycle por bytes e ensaios externos permanecem explicitamente pendentes.

## Validação final

- `npm run typecheck`: passou.
- `npm test -- --maxWorkers=4`: 89 arquivos, 499 testes passaram; três benchmarks opt-in separados da suíte normal.
- `LEGACY_CAPACITY_BENCH=1 npm test -- src/main/audit/account-capacity.test.ts --maxWorkers=1`: passou, 200/600/1000/2000 publicações com 1/3/5/10 destinos; zero falhas e zero credenciais cruzadas. Na execução final, a recepção de 2000 intenções levou 19,56 s: a arquitetura absorve a fila, mas a latência de cadastro em massa continua uma oportunidade de melhoria.
- `npm run build`: passou.
- `npx playwright test tests/e2e/pipeline-jit.spec.ts`: passou no Electron compilado, usando contas sintéticas e mídia local. O teste espera a conclusão do login de visitante antes do IPC; nenhum POST real.

O primeiro comando de capacidade foi executado por engano com Node externo ao Electron e encontrou incompatibilidade de ABI do SQLite. A execução correta acima usa o runtime Electron e não exigiu reconstruir dependências. A verificação de whitespace apontou apenas linhas vazias finais já existentes em arquivos fora desta intervenção; alterações anteriores do workspace foram preservadas.
