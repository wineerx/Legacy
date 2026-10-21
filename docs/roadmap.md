# Roadmap

## Plano atual — 2026-10-09

O próximo ciclo proposto é **Container → Scheduler → Agenda**, dividido em 22 entregas e reaproveitando os recursos já presentes no checkout.

- [Roadmap consolidado: épicos, sequência, dependências e referências visuais](plans/2026-10-09-container-scheduler-agenda.md)
- [PR 01: especificação da fundação de Containers](specs/2026-10-09-pr01-containers.md)

Status: [fundação do PR 01 implementada no checkout](pr01-containers.md) e [Biblioteca → Container rascunho → revisão do PR 02](pr02-library-container-drafts.md); [configuração visual por Container do PR 03](pr03-container-visual.md); [Templates visuais versionados do PR 04](pr04-visual-templates.md); [auditoria do snapshot congelado e Scheduler quota-aware do PR 05](pr05-quota-scheduler.md); [janelas de pico e distribuição de Containers do PR 06](pr06-peak-windows.md); [janela do Container, atraso e ajustes do PR 07](pr07-container-window.md); [Calendário centrado em Containers do PR 08](pr08-calendar.md); [Sheet de detalhes da Agenda do PR 09](pr09-agenda-sheet.md); PR 10 e seguintes pendentes. A proposta foi confrontada com documentação e contratos locais; não altera a instalação nem certifica integrações externas. O cronograma abaixo é histórico e inclui limitações superadas por revisões posteriores, como publicação local, múltiplos destinos Instagram e importação TikTok via Apify.

## Histórico das fases originais

## Fase A (concluída): fundação e biblioteca

Importação, capa uniforme, banner, grade 9:16, métricas por CSV/JSON, fila, exportação TikTok manual, instalador.

## Fase B (Plano 2): Instagram oficial

- Broker Cloudflare (Workers, D1, R2): OAuth Instagram com ticket de uso único, URLs assinadas de vídeo.
- Conexão de contas, tokens em `safeStorage`, estado `needs_reconnect`.
- Sincronização dos posts e métricas da conta própria; download da própria mídia (`ig_own`).
- Publicação de Reels com `cover_url` (confirmar em teste real) e agendamento em sequência com `posts` e `post_targets`.
- Licença (Ed25519, planos e limites), auto-update e assinatura de código.
- Teste real somente com autorização explícita do usuário.

## Fase C: perfis de terceiros

Somente a API oficial Business Discovery (Facebook Login): listar posts e métricas de contas profissionais. Sem download e sem scraping de vídeos de terceiros.

## Fase D

Campanhas, calendário completo, `planSlots` (janelas, máximo por dia, DST) em uso real (janelas de pico em uso desde o [PR 06](pr06-peak-windows.md)), TikTok por API se a elegibilidade for aprovada.
# Atualização entregue em 2026-10-05

- Download de reels públicos por URL de perfil via Apify, limitado e persistente; validação externa pendente de token/saldo do operador.
- Configurações de armazenamento dos vídeos por workspace, preservando acesso aos locais anteriores.
- Fora deste incremento: migração física dos vídeos antigos, TikTok por perfil, extração local com BrowserWindow e seleção remota antes do download.
