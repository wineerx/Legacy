# Painel operacional, credenciais, eventos e tutoriais

Data: 2026-10-05. Incremento local 0.2.0.

Mantemos a stack e a fila SQLite existentes. O painel agrega tarefas e métricas por workspace; métricas desconhecidas permanecem null e a cobertura é mostrada junto da soma. A configuração Apify é acessível na Visão geral e Configurações, com teste read-only `GET /v2/users/me` (fonte: https://docs.apify.com/api/v2/users-me-get).

Chaves são cifradas no main com safeStorage, usando DPAPI no Windows (fonte: https://www.electronjs.org/docs/latest/api/safe-storage, consultada em 2026-10-05). O worker recebe snapshots somente pelo canal interno de utilityProcess, espera a primeira configuração antes de processar tarefas e recebe alterações sem reinício. Contextos de domínio dependem de uma interface de segredo, sem importar Electron.

Eventos `job.done`/`job.failed` geram notificações conforme preferências e outbox de webhooks na mesma transação que encerra a tarefa. Entregas usam a própria fila, assinatura HMAC-SHA256, payload limitado a identificação/estado da tarefa e dedupe por evento. Webhooks de saída foram escolhidos para automação externa; envios desativados por solicitação explícita. Recebimento e validação de eventos Meta/TikTok dependem das respectivas integrações futuras.

Os tutoriais são internos e acessíveis por teclado: Radix Dialog mantém foco no popup, o destaque acompanha o controle ao rolar e as etapas navegam entre rotas. Progresso local por workspace; plano de perfil no SQLite. O tour nunca simula publicação ou usa credenciais fictícias para chamadas reais.

Legendas prontas são modelos editoriais, diferenciados de legendas de reels com métricas reais. Ranking limitado aos conteúdos carregados, sem causalidade ou promessa de engajamento. Os seis perfis indicados não puderam ser lidos pela ferramenta web nesta sessão; URLs de referência foram preservadas para a busca Apify/importação.

Instalador existente é manual, `publish: null`. O pedido sobre setup de update foi tratado como consulta e atualização local para revisão; não foi inventado um canal de auto-update sem servidor ou releases. Instagram OAuth/publicação e TikTok API continuam pendentes, identificados na interface.
