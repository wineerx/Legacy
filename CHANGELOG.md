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
