# 0.7.5 — atualização de todos os perfis

- Botão de atualizar no cabeçalho Instagram consulta identidade e métricas de todos os perfis, sem importar posts nem iniciar downloads.
- Um perfil com falha não interrompe os demais; o aviso informa quantos foram atualizados e lista cada falha.
- Ctrl + clique marca/desmarca vídeos nas grades da Biblioteca e Perfis sem abrir o player nem substituir a seleção anterior.
- Opção de publicar o Reel também na grade de posts do Instagram; a escolha é persistida na tarefa e enviada como share_to_feed.
- Preserva todas as revisões da 0.7.4.

# 0.7.4 — novas revisões de perfis e contas

- Importação Todos combina Posts, Reels e Marcados com limite total e checkpoints separados, reutilizados ao tentar novamente.
- Atualização manual de identidade e métricas do perfil sem importar posts nem iniciar downloads.
- Seletor de origem por ícones com ToggleGroup Radix; mantém preferência e navegação pelo teclado.
- Contas conectadas e opções das redes em cards, com desconexão confirmada e TikTok manual.
- Alinha logos, textos e seleção nos destinos da composição; ajusta o checklist inicial.
- Centraliza o avatar e reposiciona o badge de notificações na Sidebar compactada.
- Preserva sessão visitante, fila, publicação local e revisões da 0.7.3.

# 0.7.3 — todas as revisões recentes

- Toasts empilhados com Sonner, mantendo mascote, teclado, pausa ao focar e erros persistentes.
- Calendário compacto com navegação e dias externos; avatares de perfil na lista e no cabeçalho.
- Importação Instagram permite Posts, Reels e Marcados, preserva a origem escolhida e busca a foto da conta correta com checkpoint.
- Menu de perfil simplificado; troca de workspace mantida em Configurações e desconexão Instagram em Contas.
- Pausa visitante aguarda confirmação do worker; uma entrada atrasada não desfaz a saída. Mascote interrompe animações também pelos eventos reais da janela.
- Mantém publicação local, histórico e todas as revisões da 0.7.2.

# 0.7.2 — compilação consolidada de revisão

- Reúne entrada visitante, pausa da fila, UI shadcn, importação incremental Instagram/TikTok, notificações e revisão de publicação.
- Instagram também aceita vídeos importados do computador sem post de origem, mantendo a entrega HTTPS da cópia local e versões editadas.
- Migração 0004 permite origem remota opcional no histórico e conserva os registros existentes; cópias usadas por outra publicação permanecem protegidas.
- Versão e commit real aparecem no título e em Configurações; build-info.json acompanha a compilação.
- Corrige a versão fixa do preload e estabiliza a verificação do badge durante a transição da Sidebar.
- Inclui o checkbox compacto de Selecionar todas e a remoção da frase de ajuda solicitada.
- TikTok continua com exportação manual. Esta revisão não publica uma release no GitHub.

# 0.7.1

- Publicação Instagram usa MP4 local preparado e link HTTPS temporário, evitando os contêineres ERROR do CDN de origem.
- Retentativas recuperam contêineres antigos ERROR/EXPIRED sem repetir publicações ambíguas.
- Link e cópia temporários liberados após processamento, falha, timeout ou fechamento.
- Agendamento pede download prévio e ações dos cards permanecem clicáveis.

# 0.6.1

- Prévias de capa, banner e grade; exportação manual com capa no primeiro frame, preservando o original e o áudio.
- TikTok desmarcado por padrão; menu de mídia ancorado e seleção sem sobreposição de selos.
- Configurações no menu do perfil; indicador baixados/posts na ordem correta.
- Backend bloqueia versões locais editadas no Instagram Login; original online mantém a fila de publicação.

# 0.6.0

- Criar postagem oferece Instagram conectado e TikTok manual, com revisão de destinos e fila real.
- Backend valida mídia online, destino/revisão, legendas individuais e horizonte de todo o lote.
- Modal de contas informa plataforma, permissões, status, erros e reconexão.
- Componentes compartilhados para calendário/horário, seleção, campos, menus, badges e loading.
- Sidebar recolhível persistente com tooltips, perfil local, workspace, configurações e saída da conta.
- Agendamento compartilhado em Biblioteca, Perfis e Criar postagem; original online e limites da integração ficam explícitos.

# 0.5.0

- Biblioteca como gerenciador: lista/grade persistente, filtros SQL, páginas de 60, estados reais e seleção/exclusão em massa protegida.
- Modal com arquivo, áudio, origem, métricas, publicações e timeline; salvar cópia e agendar mídia de origem online.
- Persistência do codec de áudio; junção de faixas explícitas separadas, mantendo o vídeo e falhando se a faixa informada não puder ser baixada.
- Banner/original e primeiro frame sem alteração destrutiva; player com AAC decodificado e volume ativo.
- Checklist real e persistente na sidebar, recolhível após conclusão.
- Perfis com rolagem independente e divisor estável até 1000 reels; eventos de atualização em cadastro e importação de métricas.
- Identidade e controlador do mascote existentes preservados na integração da interface.

# 0.4.0

- Design System documentado; filtros avançados recolhíveis, ações com ícones e foco acessível.
- Desafios, conquistas e ofensiva por conta em dias do workspace, com celebração persistida.
- Histórico permanente de publicações e limpeza opcional após confirmação; proteção de mídia em uso.
- Biblioteca preserva métricas/origem dos downloads e player interno.
- Notificações agrupadas por lote, filtros por categoria, não lidas e falhas.
- Corrigido identificador Instagram: user_id profissional em vez de id no escopo do app; verificação da conexão e retentativas após rejeição HTTP definitiva.

# Histórico de versões

## 0.3.1

- Player interno em Perfis e Biblioteca, com arquivo local ou prévia online.
- Link de origem disponível somente por ação explícita.
- Tratamento de URLs expiradas e formatos não suportados.

## 0.3.0

- Correções de overflow em Perfis, editor, legendas e Fila; métricas dos cards em uma linha.
- Busca de posts/reels com prévias, filtros e seleção top X, separada do download.
- Conexão Instagram profissional por token protegido e fila de publicação agendada.
- Arquivos, prévias e links de origem nos detalhes das tarefas.
- Verificação, download e instalação de atualizações pelo aplicativo, usando releases GitHub.
- CI por branch/PR, artefatos identificados pelo commit e workflow de release por tag de versão.

## 0.2.0

- Downloads Apify por perfil, escolha do armazenamento, painel, integrações e alertas.
- Webhooks de saída inicialmente desativados, tutoriais e modelos de legenda.

Autoria e direção do produto: Eduardo Ximenes (@wineerx).
