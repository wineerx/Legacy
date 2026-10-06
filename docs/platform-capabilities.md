# Capacidades das plataformas

Fontes da API oficial: spec §3, verificado em 2026-10-04. Valores: `disponível`, `condicionada`, `indisponível`, `não verificada`. As tabelas abaixo descrevem os fluxos oficiais planejados. Downloads via provedor externo são uma integração separada implementada em 2026-10-05.

## Reels públicos via Apify (2026-10-05)

Busca por URL de perfil, métricas e download: **condicionados** a APIFY_TOKEN, saldo e resposta do Actor `apify/instagram-reel-scraper`. Implementados em worker Node com fila persistente, até 100 reels por busca. Não houve validação externa com credencial real. Fonte: https://apify.com/apify/instagram-reel-scraper/input-schema e https://docs.apify.com/api/v2. Não é a API oficial Meta e não habilita publicação. Perfis privados e TikTok não são cobertos. Esta decisão substitui a antiga proibição de download de terceiros.

## Instagram (Graph API v25.0, Instagram Login)

| Capacidade | Estado | Fonte e observação |
|---|---|---|
| Conexão de conta | condicionada | Só contas profissionais (Business ou Creator); exige OAuth via broker e App Review para uso comercial. Fonte: content-publishing |
| Leitura do perfil próprio (posts, mídia) | condicionada | Escopo `instagram_business_basic`. Fase B |
| Análise de perfis de terceiros | condicionada | Só Business Discovery, que exige Facebook Login; retorna `like_count`, `comments_count`, `view_count`, sem baixar vídeo. Fase C. Fonte: ig-user/business_discovery |
| Métricas | condicionada | Insights de Reels (views, likes, comments, reach, saved, shares, total_interactions, tempo médio) com `instagram_business_manage_insights`. Hoje só por CSV/JSON |
| Download de mídia | condicionada | Na integração oficial planejada: própria conta conectada (`media_url`). Reels públicos de terceiros têm fluxo separado via Apify, descrito acima |
| Publicação de Reels | condicionada | `media_type=REELS` com `video_url` público (broker); limite de 100 posts por 24 h por conta. Fase B |
| Capa | exportação manual | A capa é inserida no primeiro frame da versão local. Publicação editada por Instagram Login permanece bloqueada; requer um transporte compatível validado |
| Agendamento | indisponível | Sem agendamento nativo na API; o app agenda localmente (PC ligado) |

## TikTok

| Capacidade | Estado | Fonte e observação |
|---|---|---|
| Conexão de conta | não verificada | Login Kit não avaliado nesta fase |
| Leitura do perfil próprio | não verificada | |
| Análise de terceiros | indisponível | Sem API oficial adequada; não faremos scraping |
| Métricas | não verificada | Hoje só CSV/JSON importado |
| Download | indisponível | Não implementado em nenhuma fase |
| Publicação | condicionada | Direct Post exige auditoria do app e elegibilidade. Nesta fase: exportação manual (pasta com vídeo, capa PNG e `legenda.txt`, mais lembrete) |
| Capa | indisponível | No upload manual a capa é escolhida no TikTok; o app gera o PNG |
| Agendamento | condicionada | Só após Direct Post aprovado; hoje, lembrete local |

Capacidade não confirmada em teste real permanece `não verificada` e com feature flag desligada.
