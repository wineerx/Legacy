# Download de reels públicos e armazenamento configurável

Data: 2026-10-05. O pedido atual autoriza downloads de terceiros e substitui a restrição antiga no CLAUDE.md. O prompt-original foi preservado.

Mantemos Electron + Node, SQLite e worker existentes. Escolha: Apify REST com `apify/instagram-reel-scraper`, sem SDK novo ou navegador oculto. O contrato publicado oferece `username` (array de URLs), `resultsLimit` e `videoUrl`. Fonte: https://apify.com/apify/instagram-reel-scraper/input-schema e https://apify.com/apify/instagram-reel-scraper; API: https://docs.apify.com/api/v2/actors-runs-post, consulta em 2026-10-05.

`fetch_profile` guarda o ID remoto em `jobs.result_json`, consulta status e enfileira `download_reel` por permalink. Um marcador anterior ao POST impede repetição automática quando não há confirmação do ID remoto. Não se promete exactly-once no serviço externo. Downloads concluídos vinculam um asset local ao post. Resultado vazio/privado/bloqueado vira erro explícito. Erros de um arquivo não impedem os demais. Chave APIFY_TOKEN exclusivamente no ambiente do main/worker.

Somente HTTPS para subdomínios de cdninstagram.com/fbcdn.net; cada redirecionamento é revalidado. DNS IPv4 público é fixado à conexão HTTPS; token enviado apenas a api.apify.com, que não aceita redirects. Streaming limitado a 1 GiB, timeout e ffprobe com demuxer/protocolos restritos. Procedência inserida junto ao asset, antes do vínculo com o post, para sobreviver a interrupções.

Pasta de vídeos selecionada pelo diálogo nativo, persistida por workspace. Destino `<escolha>/Legacy/<workspace>/media`, com teste de escrita. Troca não move arquivos: seus caminhos persistidos continuam sendo usados por edição/miniaturas. O protocolo de mídia admite diretórios dos assets registrados além da pasta interna; não libera toda a unidade escolhida. O enum SQLite de origem é texto sem CHECK: novo valor `ig_third_party` não exige alteração DDL.

Limites: reels públicos do Instagram; 100 resultados por busca; sem seleção remota antes do download, migração de arquivos antigos, scraping local ou TikTok. Não houve chamada paga nem download de perfil real na validação. Tokens, saldo, mudanças do provedor e URLs expiradas podem impedir a integração real.
