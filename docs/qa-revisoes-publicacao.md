# Revisões de fila, publicação e importação

Estas mudanças ampliam o PR #9, mantendo a preparação/publicação da cópia local de 0.7.1. A versão do instalador permanece 0.7.1; nenhuma release foi publicada.

## Comportamento entregue

| Área | Comportamento |
| --- | --- |
| Fila | Publicações confirmadas identificam o vídeo e abrem a Biblioteca com um filtro exclusivo, removível. O histórico continua acessível após remoção da cópia local. |
| Estado real | O worker mantém a tarefa e o lease em execução durante consultas intermediárias à Meta e falhas transitórias de resposta. Checkpoints evitam repetir media_publish após uma resposta incerta. |
| Sucesso | O texto de confirmação usa o token verde de sucesso. Celebração mantém o reconhecimento persistido por tarefa. |
| Repostagem | Identificadores de origem, permalink, SHA-256, histórico e tarefas ativas são comparados por workspace/conta de destino. Confirmação explícita permite repostagens intencionais. A execução revalida publicações ocorridas após o agendamento. |
| Duplicatas | Importação atualiza referências conhecidas; downloads ativos e prévias existentes não são repetidos. Cópias desnecessárias podem ser excluídas individualmente ou por seleção pela Biblioteca, preservando arquivos em uso. |
| Notificações | Exclusão individual, seleção múltipla e exclusão de todas; exclusões em massa exigem confirmação e respeitam o workspace. |
| Banner/capa | Primeiro frame recebe o banner, mantendo também o intervalo de sobreposição solicitado. Uma única codificação preserva resolução e áudio, com bitrate pelo menos igual à estimativa do original. Instagram recebe thumb_offset=0 nas versões editadas; a plataforma controla a miniatura final. |
| TikTok | Perfis e vídeos públicos são importados via Apify, com métricas disponíveis, metadados, grade paginada, deduplicação, prévias e download separado. Publicação TikTok continua sendo exportação manual. |
| Perfis | Avatar circular com foto importada quando fornecida pelo provedor e fallback de iniciais, sem alterar a altura das linhas. |
| Sidebar | Ícone de compactar ampliado; ícone de notificações preservado com badges 0 até 99+. Mascote reage ao clique e abre balão Radix com três pontos e Progress baseado nos totais persistidos da fila. |
| Destinos | Logo Instagram vetorizada transparente junto aos dois textos em coluna. Select Estado continua usando Radix/shadcn com tokens existentes. |

## Integrações e limites

O Actor TikTok usa o [contrato oficial de clockworks/tiktok-profile-scraper](https://apify.com/clockworks/tiktok-profile-scraper/input-schema). Usa o mesmo checkpoint persistido de execução/dataset da importação Instagram. Não inicia downloads pagos adicionais do Actor; URLs de vídeo disponíveis no resultado seguem o downloader HTTPS restrito a hosts da plataforma e IPs públicos. URLs expiradas e dados omitidos pelo provedor continuam sendo erros/valores ausentes explícitos.

O progresso do balão corresponde à proporção de tarefas concluídas no conjunto da fila do workspace, não a uma estimativa de bytes enviados à Meta. Uma publicação sem confirmação após uma hora termina com erro explícito e mantém seu contêiner para revisão. Nunca se infere sucesso pela falta de resposta.

A identidade, credenciais, banco e fila da instalação aberta não foram alterados. Validação usa bancos temporários isolados; nenhuma publicação real ou execução paga da Apify foi feita nesta revisão.

## Validação

Testes cobrem processamento externo pendente sem transição intermediária de estado, confirmação incerta sem segundo POST, repostagem por conta, versões editadas, importação incremental Instagram/TikTok, duração/áudio/primeiro frame, notificações por workspace, navegação para vídeo exato e acessibilidade da Sidebar. E2E exercita entrada/saída, reinício pausado, progresso de importação, celebração deduplicada, layouts menores, calendário, lote e as novas ações.

Resultado final: typecheck e build aprovados; 422 testes unitários em 78 arquivos e 23 E2E no Electron passaram.
