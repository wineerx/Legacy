# Publicação Instagram 0.7.1

Os contêineres de @365surfer que usavam URLs do CDN de origem retornaram ERROR. O arquivo recente era MP4 H.264/AAC, 720×1280 e 13,4 s; a origem respondeu HTTP 200. A Meta não forneceu subcódigo nesses contêineres.

O mesmo vídeo, remuxado para colocar moov no início e remover edit lists, servido pela implementação MediaHost reutilizada do projeto Legacy-tunel, chegou a FINISHED na conta real. Esse teste criou um contêiner de preparação; não publicou no feed. Portanto não isolamos CDN versus remux como causa única, mas validamos a substituição desse caminho de entrega.

## Fluxo

Baixar → cópia temporária MP4 → servidor apenas loopback, GET/HEAD/Range para um único caminho aleatório de 256 bits → Cloudflare quick tunnel HTTPS → criação na Meta → consultar status_code,status → FINISHED → encerrar exposição → media_publish → histórico confirmado.

O link é acessível a quem o possui enquanto aberto; não fica em logs, payloads ou banco. O túnel fecha após processamento/falha, após 15 min, ou ao parar o worker. A cópia é apagada; original e token permanecem locais. O token é enviado apenas à API Meta. Quick tunnels dependem da disponibilidade da Cloudflare e não oferecem SLA.

Na retentativa de tarefas antigas em ERROR/EXPIRED, o contêiner terminal é arquivado no checkpoint e substituído pelo fluxo local na consulta seguinte. Criar/publicar com resposta perdida continua bloqueado; PUBLISHED nunca gera outro envio. Estado desconhecido mantém o contêiner para revisão.

## Verificação

Teste real: contêiner 18077210915455580 chegou a FINISHED; publicamentePublicado=false. Testes cobrem entrega local, payload antigo, checkpoint ambíguo, estado desconhecido, Range, isolamento de caminho, TTL e encerramento. Biblioteca importada sem post remoto e versões editadas permanecem fora deste ajuste.

Fonte oficial: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
