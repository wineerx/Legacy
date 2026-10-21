# Filtros e gerenciamento de perfis

## Diagnóstico

As referências fornecidas mostram ordenação, filtros e ações em lote sem hierarquia clara. Nos filtros avançados, campos com larguras fixas e sem rótulos persistentes deixam a grade irregular. A busca de conteúdo não consulta os detalhes do perfil, e a lista não oferece remoção.

## Organização implementada

- Ordenação sempre visível, acima dos critérios de filtragem.
- Conteúdo: legenda, hashtag e tipo de mídia.
- Desempenho: visualizações, curtidas e comentários mínimos, com rótulos persistentes e campos de mesma largura.
- Resumo sempre visível: quantidade de resultados, etiquetas removíveis e limpeza geral. Critérios são aplicados enquanto o usuário edita.
- Seleção em lote separada em três grupos: seleção da página, melhores posts e ações sobre a seleção.
- Biblioteca segue o mesmo padrão: busca e estado, origem e publicação, resumo de filtros.

## Importação e métricas

Com Apify configurada, importar um link inicia a consulta de métricas do Instagram e a busca de posts independentemente. Falhar em uma consulta não impede a outra. O cabeçalho mostra o carregamento das métricas e permite atualizar apenas o perfil atual; a atualização de todos continua disponível. Cada consulta de detalhes usa Apify e pode consumir créditos. Métricas ausentes no retorno do provedor continuam representadas por um traço.

## Arquivamento

Arrastar para a direita revela uma faixa vermelha com lixeira à esquerda, limitada à área descoberta pelo card. Soltar encaixa a faixa aberta ou recolhida; clicar na lixeira arquiva. O botão de opções e as teclas seta direita, seta esquerda e Escape oferecem alternativas ao gesto. O arquivamento é persistido por workspace e mantém os posts e arquivos. Perfis arquivados podem ser restaurados; importar o mesmo link também restaura sem duplicar. Arquivar não cancela tarefas já iniciadas.

## Estudo e evolução do design

A lista de perfis começa com 280 px e permite ajuste entre 240 e 400 px pela divisória vertical. O handle fica centralizado na borda, fora da área de rolagem; o conteúdo usa o espaço restante. A largura é salva no armazenamento local do aplicativo. Setas esquerda/direita ajustam 16 px (32 px com Shift), Home/End selecionam os limites e Enter ou dois cliques restauram a largura padrão. Em telas abaixo de 1280 px, a lista ocupa toda a largura acima do conteúdo e o handle fica oculto, sem apagar a preferência desktop.

1. Mapear as tarefas principais: encontrar posts, avaliar desempenho, selecionar e preparar conteúdo, gerenciar perfis.
2. Avaliar futuras referências de componentes por clareza de rótulos, alinhamento, densidade, acessibilidade e comportamento em telas menores.
3. Incorporar referências aprovadas ao sistema visual existente, preservando agrupamento e feedback dos filtros.
4. Validar com usuários: localizar um post por legenda, combinar dois critérios, limpar critérios com o painel fechado, arquivar e restaurar um perfil.
5. Verificar estados de carregamento, ausência de resultados, falha da API e navegação por teclado antes de novas alterações visuais.
