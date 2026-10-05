# Biblioteca e onboarding — Legacy 0.5

Produto: Eduardo Ximenes (@wineerx).

## Diagnóstico e implementação

- `services/profile-download.ts` baixava somente `videoUrl`. `media/probe.ts` já identificava áudio, mas `media_assets` não o persistia. O player não era silenciado explicitamente; a amostra local mostrou 29 arquivos AAC e um sem áudio, portanto não havia uma causa única comprovada para todos os sintomas.
- URLs explícitas de faixas separadas (`audioUrl`) agora passam pelo downloader HTTPS com limite, validação de CDN, DNS e redirecionamentos. FFmpeg recebe somente arquivos locais, mapeia vídeo + áudio e gera AAC sem recodificar o vídeo. Se o áudio informado falhar, o download falha em vez de registrar um sucesso silencioso. O tempo do vídeo original é mantido.
- Apify atualmente fornece principalmente `videoUrl`; não presumimos que metadados de música sejam uma faixa separada sincronizada. Não criamos áudio quando o provedor não o retorna. Fontes e URLs expiradas exigem nova consulta.
- `ProfilesPage` usava um painel esticado conforme a altura da grade. Agora o painel tem a altura da área de trabalho e os dois lados rolam separadamente. QA verifica 1, 10, 100 e 1000 reels.
- `services/grid.ts` mantém filtros SQL e paginação. Biblioteca usa páginas de 60, miniaturas lazy e consultas agrupadas para dados da página. Vídeos só são carregados no player aberto.
- `services/media-manager.ts` cruza arquivos, posts, perfis, versões, tarefas e o ledger existente. Não há nova tabela de publicações. Os estados vêm das tarefas e das publicações confirmadas, nunca de porcentagens inventadas.

## Uso

1. O checklist **Primeiros passos**, acima de Configurações, abre as cinco ações reais. Marcos concluídos persistem por workspace. Ele pode ser recolhido quando completo.
2. Na Biblioteca, busque por nome, perfil, legenda ou origem. Filtre estado, perfil de origem, conta que publicou, plataforma e data inicial. TikTok representa exportações para postagem manual; exportação não é publicação confirmada.
3. Alterne **grade/lista**. A preferência é salva por workspace. Selecione itens individualmente ou a página; exclua até 200 por confirmação. Arquivos usados por tarefas ativas/agendadas são bloqueados. As demais cópias são apagadas; originais externos e histórico confirmado permanecem.
4. Clique na mídia para ver arquivo, tamanho, resolução, duração, codec de áudio, origem, métricas, publicações e timeline. Dados ausentes são “—”. Publicações confirmadas têm páginas de 50; a timeline inclui até 100 tarefas recentes relacionadas.
5. **Exibir banner** alterna versão de banner criada no Legacy/original. Não modifica arquivos. Novas miniaturas têm um frame inicial original; arquivos antigos podem gerar esse frame ao abrir os detalhes. Sobreposição já gravada no vídeo de origem não pode ser retirada por esta preferência.
6. No menu de mídia, abra detalhes, prepare postagem, salve uma cópia ou agende na conta Instagram conectada. Agendamento requer origem online válida; arquivos locais ainda seguem a composição/exportação manual existente.

## Estados e integridade

- Pronto: arquivo importado, sem tarefa pendente relevante.
- Processando: miniatura ou banner na fila/em execução.
- Agendado: publicação Instagram pendente/em execução.
- Falhou: tarefa relacionada com falha.
- Publicado: existe confirmação no ledger. O histórico continua visível mesmo quando há novo agendamento.
- Downloads aparecem na seção de fila da Biblioteca antes de existir um arquivo completo. Importação mostra estado indeterminado durante cópia, hash e análise. Atualizações usam eventos existentes e polling; não introduzem sockets novos.
- Exclusão verifica referências sob transação `immediate`; a remoção da cópia e da linha ocorre com o bloqueio de escrita mantido, evitando novas tarefas entre essas etapas. Falha de disco é reportada por arquivo.

## Migrações e recuperação

`0002_mean_darkstar` acrescenta `audio_codec`, mantendo arquivos antigos como não verificados. Os detalhes consultam FFprobe e persistem AAC/outro codec ou `none` (sem faixa). `0003_dark_morg` acrescenta índices para jobs por workspace/tipo/estado, mídia de posts e SHA de publicações.

São migrações aditivas. Para voltar ao binário 0.4, as colunas/índices extras podem permanecer. Para rollback do banco, feche o Legacy e restaure o backup SQLite anterior com os arquivos de mídia correspondentes; não apague tabelas de histórico. Faça backup com SQLite, ou copie banco e WAL/SHM somente com o aplicativo fechado.

## Validação

Unitários e integrações cobrem junção de streams reais, preservação de áudio no download/importação, falha de áudio, isolamento entre workspaces, filtros, estados, ledger, exclusão bloqueada e preferências. Electron E2E valida decodificação AAC, player interno, lista persistente, primeiro frame, layout até 1000 reels e telas em 800/1024/1440 px. Testes não publicam conteúdo real nem comprovam autorização externa da Meta.

Referências: [FFmpeg: mapeamento de streams](https://ffmpeg.org/ffmpeg.html), [Apify Instagram Reel Scraper](https://apify.com/apify/instagram-reel-scraper), [Shadcn File Manager](https://www.shadcn-ui-blocks.com/blocks/application-pro/file-manager). Composição adaptada das imagens enviadas; nenhum código premium foi copiado.
