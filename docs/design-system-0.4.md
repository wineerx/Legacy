# Design System Legacy — 0.4

Responsável pelo produto: Eduardo Ximenes (@wineerx).

## Auditoria e plano

Perfis mistura ações globais, ordenação, filtros e ações da seleção; Biblioteca perde métricas na passagem do download; Notificações tem uma lista plana com ações repetidas; Contas apresenta instruções extensas sem etapas. A grade e o player já têm componentes reutilizáveis.

1. Separar cabeçalho (identidade + ação principal), barra de ferramentas, filtros avançados recolhíveis e barra da seleção. Reutilizar Button, Tooltip, Pills, Modal e tokens existentes.
2. Usar controles de 36 px, espaçamento de 8/16/24 px, borda e raio dos tokens; painéis com min-width:0 e quebra de linha. Ícones secundários precisam de nome acessível e tooltip; a ação principal mantém texto.
3. Agrupar notificações por lote/tarefa e categoria. Resumo mostra quantidade e não lidas; detalhe abre com teclado. Falhas conservam mensagem e acesso à Fila.
4. Exibir origem, métricas conhecidas e contas que já publicaram no player e na Biblioteca. Ausência de métrica continua como “—”.
5. Desafios usam dados locais verificáveis, com progresso e ofensiva por conta no fuso do workspace. Celebrar somente novos desbloqueios, sem recriar eventos ao navegar ou reiniciar.
6. Limpeza após publicação é opt-in por lote. Registrar conta, hash, origem e métricas antes de remover a cópia do Legacy. Não remover mídia usada por outras tarefas pendentes. Original importado permanece intacto.

## Estados e movimento

Todos os controles têm foco visível, carregando, indisponível e erro. Motion: 150–220 ms para hover/entrada, celebração breve; prefers-reduced-motion remove movimento. Evitar textos longos nos controles: detalhes ficam em ajuda contextual ou painéis expansíveis.

## Referências

Inspiração visual, sem copiar código premium: [perfil de workspace](https://www.shadcn-ui-blocks.com/blocks/application-pro/onboarding/workspace-profile-step), [compositor de incidentes](https://www.shadcn-ui-blocks.com/blocks/application-pro/status-health/incident-update-composer), [aprovação de dispositivo](https://www.shadcn-ui-blocks.com/blocks/application-pro/auth-pages/device-approval-page), [diretório de parceiros](https://www.shadcn-ui-blocks.com/blocks/marketing-pro/partner-sections/partner-directory-preview), [grupos de botões](https://www.shadcnblocks.com/components/button-group), [configurações](https://shadcnstudio.com/blocks/dashboard-and-application/account-settings#account-settings-07).

## Critérios de entrega

Verificar 800/1024/1440 px sem overflow do documento, filtros e grupos acessíveis por teclado, player interno, migração de banco existente, idempotência do histórico, limites de workspace, fuso/intervalos da ofensiva, falhas e retentativas de publicação e limpeza. Testes simulados não comprovam publicação real na Meta; registrar separadamente a validação externa.
