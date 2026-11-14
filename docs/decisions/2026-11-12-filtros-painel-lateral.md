# Filtros das grades em painel lateral

Data: 2026-11-12. Desenho completo e estudo dos filtros: `docs/superpowers/specs/2026-11-12-filtros-grade-design.md`.

## Decisão

Biblioteca e Perfis trocam o cartão de filtros do topo (barra, combinações rápidas e etiquetas ativas) por uma barra única acima da grade e um painel lateral à esquerda na Biblioteca e à direita em Perfis. Os grupos mais usados têm campo tracejado na barra; todos os grupos ficam no painel, recolhíveis e com contagem. Um grupo avançado com seleção ganha campo na barra quando aplicável. Estado, período de importação e favoritos ficam no painel da Biblioteca.

- Dentro de um grupo de várias escolhas as opções se combinam por OU; entre grupos, por E.
- Estado da Biblioteca aceita várias escolhas, incluindo "Não agendado" (sem publicação no Instagram na fila ou em execução).
- Perfil de origem lista apenas perfis acompanhados com pelo menos um vídeo baixado ainda na Biblioteca (arquivados incluídos), via `library.filterOptions`. Conta que publicou vem do histórico de publicação.
- "Plataforma" foi separada em Origem (Computador, Instagram, TikTok) e Destino (Instagram publicado ou pendente, TikTok exportado).
- Filtros novos: Biblioteca ganha Duração, Desempenho na origem e Hashtag; Perfis ganha Download, Publicação, Período de publicação e Duração.
- As combinações rápidas foram removidas: cada atalho virou opção de um grupo.
- "Exibir banner nas miniaturas" saiu dos filtros e virou botão de alternância ao lado de grade/lista.
- A Fila de mídia saiu do corpo da Biblioteca: o menu Ações da biblioteca mostra a contagem e abre a gaveta de tarefas. O menu também reúne importação, rascunhos e a abertura do painel de filtros.

## Compatibilidade

`grid.query` continua aceitando `status`, `sourceProfile`, `publicationAccount` e `platform`. Os campos novos são listas opcionais (`statuses`, `sourceProfileIds`, `origins`, `destinations`, `publicationAccounts`) e `minDurationMs`, `downloaded`, `published`.

## Pendente

O pedido citou "o padrão do vídeo Rios" para o campo tracejado. A referência não foi encontrada no repositório; a implementação segue o campo tracejado com etiquetas removíveis dentro dele. Confirmar com a pessoa.
