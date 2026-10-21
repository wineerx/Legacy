# Scheduler quota-aware — PR 05

Entrega no checkout em 2026-10-09, precedida de auditoria do snapshot congelado dos PRs 01–04. PR 06 (janelas de pico e distribuição), PR 07 (previsão de término e propostas de ajuste), Agenda e novas integrações ficaram fora. Nenhum conteúdo foi publicado; toda resposta da Meta nos testes é simulada.

## Fase 1 — Auditoria do snapshot congelado

Fluxo rastreado: `Template versionado → Container draft → schedule → snapshot por item → receita (media_versions) → job (payload) → JIT → retry/cache/reinício`. Teste: [frozen-snapshot.test.ts](../src/main/audit/frozen-snapshot.test.ts). Usa FFmpeg real, banco real e um rasterizador que registra o layout recebido pelo JIT.

| # | Verificação | Resultado antes | Prova |
|---|---|---|---|
| 1 | Agendamento congela composição, imagens, fontes e contexto efetivo | Composição, imagens e contexto: ok. Versão do renderizador/fontes **não** era registrada na receita | teste `1–2` |
| 2 | Legenda efetiva por vídeo | Ok: payload do job e `layoutContext` da receita trazem a legenda do item (override ou base) | teste `1–2` |
| 3 | Editar, renomear, arquivar ou excluir o Template não muda o resultado | Ok, inclusive renomear a conta de destino | teste `3–4` |
| 4 | Retry, cache hit e reinício reutilizam receita e hashes, sem ler o Template | Ok: cache hit sem nova renderização; reinício com cache apagado renderiza layout idêntico com o Template já excluído | teste `3–4` |
| 5 | Agendamento repetido idempotente | Ok: mesmos jobs, nenhuma receita extra; rascunho agendado bloqueia edição | teste `5` |
| 6 | Original intacto; snapshots v1 compatíveis | Ok | teste `6` |
| 7 | Serviço/worker não alteram silenciosamente a intenção | **Falhava:** receita com contexto reescrito era renderizada; original trocado no disco era usado; payload do job divergente do item seria publicado | testes `7` e `7b` |

Correções, com testes que falham no código anterior:

- **Lacre da receita** (`recipeSha256`): hash de snapshot referenciado, override individual, contexto efetivo, versão do renderizador e hash do original. O JIT recusa receita alterada.
- **Versão do renderizador** (`rendererVersion`) gravada no agendamento. Se fontes ou layout do app mudarem antes da publicação, o item é recusado com pedido de reagendamento, em vez de sair diferente do revisado.
- **Hash do original** (`sourceSha256`) gravado no agendamento e conferido no JIT. Linhas sem SHA-256 real (legado/fixtures) não são comparadas.
- **Intenção do job:** antes de qualquer chamada à API, o worker compara legenda e receita do payload com o `effective_snapshot_json` do item do Container. Divergência é recusada.

Receitas planejadas antes desta entrega não têm lacre e seguem aceitas, como antes.

## Fase 2 — Quota por conta

### Contrato consultado

Documentação oficial da Meta para `GET /{ig-user-id}/content_publishing_limit`: no host `graph.instagram.com` (Instagram Login, o usado pelo app, `v25.0`), com `instagram_business_basic` e `instagram_business_content_publish`. A resposta traz `quota_usage` e `config.{quota_total, quota_duration}` (segundos), no envelope `{ data: [ … ] }`. A Meta descreve os valores como atuais, sujeitos a mudança. Por isso nenhum limite ou duração é fixado: tudo vem da resposta em runtime.

### Snapshot

Migration aditiva `0010_provider_quota_snapshots`: uma linha por workspace/provider/conta com fonte, `quota_usage`, `quota_total`, `quota_duration_sec`, horário da última leitura válida (`fetched_at`), da última tentativa (`attempted_at`), resultado (`ok`/`error`) e tipo de erro (`not_connected`, `network`, `rate_limited`, `permission`, `invalid_response`, `provider_error`). Falhas preservam a última leitura válida. Não guarda token, resposta bruta nem dados da conta além do id.

A consulta é só GET, com token no header `Authorization`. Respostas incompletas ou com tipos errados viram `invalid_response`. Rate limit cria cooldown `quota_status` pelo limiter existente, inclusive o escopo da aplicação inteira (códigos 4/613), e a próxima consulta espera sem chamar a Meta. Sucesso limpa o cooldown da conta.

Uma leitura vale como base de cálculo por 15 minutos (`QUOTA_FRESH_MS`); depois aparece como **desatualizada** e a capacidade passa a **desconhecida**.

### Contagem sem dupla contagem

Regra: tudo o que aconteceu até o instante da leitura (T0) está em `quota_usage`. Localmente só se soma o que veio depois:

- publicações confirmadas no ledger (`publication_history`) depois de T0;
- operações remotas ambíguas (publish enviado sem confirmação) com atividade depois de T0, contadas separadamente e nunca também como pendentes;
- jobs pendentes (`queued`/`running`) da conta, de qualquer Container ou lote legado, nos horários UTC planejados (ou agora, se atrasados);
- candidatos do rascunho em revisão.

Na janela móvel informada (`quota_duration`), confirmações locais anteriores a T0 mantêm seus horários reais. O restante de `quota_usage` (outros apps ou horário desconhecido) é posicionado em T0, o mais tarde possível, e expira em T0 + janela. Itens que não cabem não consomem quota, porque a Meta os recusaria e a fila os adiaria. Assim, um item acima do limite não contamina os seguintes. Sem leitura válida e atual, o resultado é `unknown`: sem limite, capacidade ou horário inventados.

### Reserva atômica

Os jobs já são o registro das reservas. Dentro da transação IMMEDIATE de `schedule`, depois de criar os jobs, a projeção da conta é recalculada. Se algum item deste Container exceder a quota, ou se ele empurrar um job já agendado para além dela, tudo é desfeito: jobs, receitas e snapshots. Agendamentos concorrentes, inclusive por conexões distintas, se serializam no lock de escrita, e o segundo enxerga as reservas do primeiro. A repetição de um agendamento já feito continua retornando os mesmos jobs. Com capacidade desconhecida, a política existente se mantém: agenda e a fila protege a conta.

### Fila

- **Antes de preparar um novo contêiner remoto:** se uma leitura atual já mostra a quota esgotada, o worker adia sem nenhum POST e sem consumir tentativa. A retomada é o primeiro instante em que uma publicação cabe na janela.
- **Recusa da Meta (9 / 2207042):** o worker lê a quota em seguida (GET) e adia usando a janela informada. Sem leitura válida, mantém a estimativa existente de 24 horas e diz que é estimativa.
- **Ambos os casos:** desloca a sequência pendente da conta pelo mesmo intervalo (ordem e espaçamento preservados) e mantém IDs, payloads e checkpoints. Também registra no checkpoint causa, horário da leitura, uso, limite e janela. A Fila mostra a causa e o horário da consulta.
- **Preservado:** isolamento por conta, leases com fencing, idempotência e reconciliação. Operações ambíguas só são consultadas por GET e nunca repetem POST. Nada redireciona jobs para outra conta, comprime intervalos ou redistribui Containers.

### Interface

Na revisão do Container, o painel **Quota de publicação · Instagram** mostra separadamente: consumo e limite informados pela Meta com a janela, publicações após a consulta, publicações sem confirmação remota, já agendadas na conta, itens deste Container e capacidade estimada agora. Aponta os itens que excedem e a última consulta/leitura válida. Estados: carregando, erro com nova tentativa, desatualizada, desconhecida (com a causa e a política atual) e valores ausentes como "—" com tooltip "Indisponível". Uma leitura automática por conta quando não há dado atual, mais o botão **Atualizar quota**. Após o agendamento, o painel continua visível e conta os itens como reservas. [Captura](screens/qa-quota/revisao-acima-da-quota.png).

## Critérios de aceite

- [x] Snapshot oficial por conta com fonte, horário, valores, validade, erros e última leitura válida preservada; sem token.
- [x] Limite e janela lidos em runtime; testes com 3/600 s, 5/1 h, 9/2 h, 25/2 h, 50/24 h e 100/48 h.
- [x] Quota oficial, confirmadas locais, incertas, pendentes e candidatos separados; sem dupla contagem antes/depois de T0.
- [x] Reserva validada atomicamente; Containers concorrentes e conexões separadas não reservam a mesma capacidade.
- [x] Quota desconhecida, desatualizada ou inválida não gera limites nem previsões.
- [x] Adiamento por quota sem consumir tentativas, com causa e horário da consulta; ordem/intervalos preservados; contas isoladas.
- [x] POST ambíguo nunca repetido; checkpoints, leases (fencing), snapshots e idempotência preservados; jobs legados contados.
- [x] Regressão da auditoria da Fase 1.

## Validação

- `npm run typecheck` e `npm run build`: aprovados.
- `npm test -- --maxWorkers=2`: 643 testes aprovados em 107 arquivos; 3 benchmarks opt-in ignorados.
- Novos: [quota.test.ts](../src/shared/quota.test.ts) (algoritmo), [instagram-quota.test.ts](../src/main/services/instagram-quota.test.ts) (transporte real `instagramJson` com socket simulado, banco real, duas conexões ao mesmo arquivo, worker real via `processNext`), [QuotaPanel.test.tsx](../src/renderer/features/library/QuotaPanel.test.tsx) e a auditoria.
- Electron E2E [quota.spec.ts](../tests/e2e/quota.spec.ts): app real com banco temporário, conta sintética e leitura da Meta simulada no banco; recusa acima da quota sem jobs, aceite dentro dela, reservas visíveis, leitura desatualizada sem acesso à rede e agendamento com capacidade desconhecida. Também passaram os E2E de Templates, configuração visual, rascunhos, pipeline JIT, Fila e publicação.

## Limitações

- Corrigido no PR 06: o painel de quota consultava a Meta automaticamente também nos E2E sem cooldown. Agora `LEGACY_PROVIDER_NETWORK=off`, ativo em todo o Playwright, recusa a chamada localmente.

- A janela e a contagem por horário são inferência local: a Meta informa apenas o total na janela atual. Publicações de outros apps, sem horário conhecido, são supostas no instante da leitura, o que pode atrasar a capacidade estimada, nunca antecipá-la.
- Uma operação remota ambígua anterior à leitura é tratada como refletida (ou não) pela Meta; depois dela, é contada como consumo. Se não tiver sido publicada, a estimativa fica conservadora.
- Uma leitura vale 15 minutos para cálculo. Depois, a capacidade fica desconhecida até nova consulta.
- O E2E não cobre o envio real à Meta: o worker do app instalado chamaria a rede. A integração do worker com a quota foi verificada com banco real e `processNext`, sem rede.
- Receitas sem lacre (agendadas antes desta entrega) não ganham a verificação nova. Uma mudança de `RENDERER_VERSION` em versões futuras exigirá reagendar itens com Template ainda não publicados.
