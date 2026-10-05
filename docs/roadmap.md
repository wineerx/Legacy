# Roadmap

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

Campanhas, calendário completo, `planSlots` (janelas, máximo por dia, DST) em uso real, TikTok por API se a elegibilidade for aprovada.
# Atualização entregue em 2026-10-05

- Download de reels públicos por URL de perfil via Apify, limitado e persistente; validação externa pendente de token/saldo do operador.
- Configurações de armazenamento dos vídeos por workspace, preservando acesso aos locais anteriores.
- Fora deste incremento: migração física dos vídeos antigos, TikTok por perfil, extração local com BrowserWindow e seleção remota antes do download.
