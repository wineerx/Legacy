# Publicação e UI — Legacy 0.6

Produto de Eduardo Ximenes (@wineerx).

## Causa corrigida

Criar postagem chamava exclusivamente `export.tiktok`. O destino Instagram agora consulta a conta do workspace, revisa data/horário e envia `compose.scheduleInstagram`. O serviço resolve os assets para posts com URL online, valida todos antes de criar o lote e chama a fila real `publish_instagram`. O worker existente cria o container, acompanha o processamento, publica e registra o histórico. Não se coloca um token em payloads.

A conta e sua revisão são fixadas na confirmação; troca ou saída invalida o destino, sem redirecionar tarefas para outra conta. O limite de 90 dias considera o último item, além de impedir passado no renderer e no backend. A legenda é individual por vídeo.

## Conexões e limites

- Instagram usa a conexão já implementada por Instagram User Access Token, protegida pelo Windows. O modal informa permissões, identidade, reconexão e erros. O link para o painel Meta agora pode abrir no navegador externo. Não se implementou OAuth sem redirect URI e credenciais de servidor configurados.
- A consulta de identidade não comprova a permissão content_publish; a API confirma ao executar. Os testes usam respostas sintéticas e não comprovam uma publicação em uma conta real.
- Uma conta Instagram por workspace. O menu lateral troca workspaces. Não há múltiplas contas dentro do mesmo workspace.
- Capas, banners e prévias de grade são aplicados à exportação manual, com capa inserida no primeiro frame e original preservado. Instagram publica o original online. Arquivos somente locais e edições locais de capa/banner precisam de hospedagem pública adicional; ficam bloqueados nesse destino com explicação. Não se apresenta uma publicação editada quando o backend envia o original.
- TikTok continua exportação manual, conforme escolha do usuário. O modal explica que não existe uma conexão OAuth/API configurada e não simula conta conectada.
- Ao escolher ambos, a tarefa Instagram e a exportação são operações distintas. Se a exportação falhar após o agendamento, a mensagem informa que Instagram já está na fila. Confira e cancele pela Fila quando necessário.
- Sair no menu do usuário desconecta Instagram e remove o token do workspace. Não existe uma sessão de login local a revogar. Nome/e-mail são identificação local opcional; não são dados de uma conta online.

## Componentes

`ui/Fields`, `Dropdown`, `DeliveryTime` e `styles/controls.css` centralizam campos, seleção, busca, textarea, badges, loading, calendário e menus. Input, Button, Toggle, Tooltip e Modal existentes são reutilizados.

| Estado | Implementação |
| --- | --- |
| default / hover / active | Tokens de painel, borda e interação compartilhados |
| focus | Foco visível, rótulos associados e descrições acessíveis |
| disabled | Sem ação e indicação visual, mantendo explicação quando aplicável |
| loading | Spinner e aria-busy; ação principal bloqueada durante operação |
| error | Mensagem contextual, aria-invalid e borda de erro em campos |
| success | Badge de conexão e campos data-state=success |
| selected | Checkbox/radio nativos, aria-pressed e contraste de seleção |

Estados são aplicados conforme a semântica: um spinner não tem estado de seleção, nem um tooltip precisa de erro de validação. Select com multiple reutiliza o mesmo componente e os controles nativos acessíveis.

O calendário oferece mês anterior/próximo, data e hora nativas, atalhos e resumo no fuso do workspace. Biblioteca, Perfis e Criar postagem usam o mesmo componente. Sidebar salva recolhimento, mantém mascote, tooltips e menu de perfil local, workspace, configurações e saída da conta.

Referências: imagens fornecidas pelo usuário; [shadcn sidebar-07](https://ui.shadcn.com/blocks/sidebar), [Meta Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing). Nenhum código premium foi copiado.

Upload resumível de arquivos locais não é habilitado para a conexão Instagram Login atual: o [exemplo oficial da Meta](https://github.com/fbsamples/reels_publishing_apis/tree/main/insta_reels_publishing_api_sample) usa Facebook Login. O backend rejeita versões editadas antes de enfileirar; não envia o original silenciosamente quando foi escolhida uma edição.
