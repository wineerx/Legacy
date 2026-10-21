# Roadmap consolidado — Container → Scheduler → Agenda

Data: 2026-10-09. Status: proposta de produto e implementação, sem código entregue por este documento.

Atualização: o usuário aprovou e autorizou a fundação de Containers. O [PR 01 está implementado no checkout](../pr01-containers.md); os PRs seguintes continuam como planejamento e não foram iniciados.

Este plano organiza o pedido de Eduardo Ximenes em entregas pequenas, considerando a documentação e os contratos presentes no checkout. A prioridade é transformar o agrupamento de publicações em uma unidade persistente de planejamento e operação. A primeira entrega está detalhada na [especificação do PR 01](../specs/2026-10-09-pr01-containers.md).

## Base considerada

Leitura inicial: README, CLAUDE, roadmap, progresso, arquitetura, arquitetura alvo, migração, pipeline, state machine, operações de fila, quota Instagram, documentação de publicação/biblioteca, design system, segurança, diagnósticos, revisões e changelog. Depois foram conferidos schema, contratos IPC, agendamento Instagram, cálculo de quota, claim da fila, compositor e planSlots. Não foi aberta a aplicação nem consultado o banco da instalação.

O checkout contém muitas alterações anteriores, incluindo migrations 0005–0007. A base da futura implementação deve ser essa árvore revisada, não apenas a versão publicada. Este documento não certifica essas alterações nem presume que estejam distribuídas. Documentos de versões antigas continuam como registros históricos; não descrevem integralmente o comportamento atual.

| Tema do pedido | Evidência atual | Trabalho restante |
| --- | --- | --- |
| Containers | `batchId` em payload, índice de lote e agrupamento na Fila | Entidade persistente, itens ordenados, rascunho, controle e resumo integral |
| Jobs independentes | State machine, lease monotônica e checkpoints por publicação | Vincular ao Container sem barreira entre itens |
| Biblioteca em massa | Seleção individual/página, ações em massa e seleção Top X em Perfis | Top N na Biblioteca, revisão/reordenação e integração com Containers |
| Processamento JIT | `versions.planVideo`, receitas e cache verificado | Configuração compartilhada por Container e marca d'água |
| Templates | `cover_templates` e compositor de capa/banner | Modelo visual completo, revisões e editor reutilizável |
| Quota | Cooldown por conta, recusa Meta 9/2207042 adia sem gastar tentativas | Consulta oficial de consumo/total, planejamento por janela móvel e estado operacional WAITING_QUOTA |
| Horários | `planSlots` aceita janelas, dias, intervalo e máximo por dia | Conectar ao fluxo real, considerar reservas/contas e quota móvel; máximo por dia não equivale a quota móvel |
| Legendas | Base e personalizações resolvidas no compositor; job recebe legenda final | Persistência e edição da relação base/override no Container |
| Fila | Paginação SQL, árvore por batchId, detalhes, retry e reagendamento | Resumo por entidade, totais do lote inteiro e recuperação contextual |
| Multi-account | `destination_accounts`, credenciais e limites por destino; UI de contas | Expor quotas, capacidade e operação por conta; OAuth/refresh continuam pendentes |
| TikTok | Importação via Apify e exportação manual | Direct Post é integração separada, condicionada a requisitos externos |
| UI | Tokens próprios e componentes Radix/shadcn já incorporados | Completar consistência nos novos fluxos, sem remover identidade/mascote |

Fontes locais principais: [arquitetura alvo](../target-architecture.md), [state machine](../queue-state-machine.md), [quota](../instagram-publication-quota.md), [migração](../migration-plan.md), [operações da fila](../queue-operations.md), [revisões](../qa-revisoes-publicacao.md) e [entrada/UI](../decisions/2026-10-06-guest-ui.md).

## Épicos e sequência

Os números de PR identificam entregas planejadas, não pull requests existentes no GitHub. Cada linha requer critérios de aceite e verificações próprias antes de iniciar a seguinte. QA e consistência visual acompanham todas as entregas; os PRs 20 e 22 consolidam a validação transversal.

| Fase / épico | PR | Entrega concreta | Dependências e limite |
| --- | --- | --- | --- |
| 1 · Containers | 01 | Entidade, itens, snapshots, agendamento atômico e controle no backend | Reusar destinos, recipes, jobs e ledger. Sem nova tela nesta entrega |
| 1 · Biblioteca em massa | 02 | Criar/adicionar a rascunho, selecionar página/Top N, preview, reordenar/remover | 01; seleção deve declarar se alcança página ou resultado filtrado |
| 1 · Configuração visual | 03 | Watermark opcional, posição/escala/opacidade e banner por Container | 01–02; original preservado, preview e receita JIT |
| 1 · Templates | 04 | CRUD/editor/preview de template visual versionado | 03; alteração do template não muda snapshots agendados |
| 2 · Scheduler | 05 | Snapshot de quota por conta e planejamento quota-aware — [entregue](../pr05-quota-scheduler.md) | 01; estender o cooldown existente, sem hardcode de 50 ou 100 |
| 2 · Scheduler | 06 | Janelas de pico configuráveis e distribuição de Containers — [entregue](../pr06-peak-windows.md) | 05; evoluir planSlots, considerar reservas e janela móvel |
| 2 · Scheduler | 07 | Janela planejada, estimativa atual, atraso e proposta de ajuste — [entregue](../pr07-container-window.md) | 05–06; usuário escolhe alteração de intervalo/estratégia |
| 3 · Agenda | 08 | Dia/semana/mês/timeline centrados em Containers — [entregue](../pr08-calendar.md) | 01 e 07; publicar mês/semana primeiro se necessário para manter o diff pequeno |
| 3 · Agenda | 09 | Sheet com conta, itens, progresso, janela e ações — [entregue](../pr09-agenda-sheet.md) | 08; totais integrais e lista paginada |
| 3 · Agenda | 10 | Drag & drop com preview de impacto e confirmação | 05–09; mesmas validações no backend e revisão otimista |
| 4 · Legendas | 11 | UI para legenda base persistida | Fundação em 01; não recriar o compositor atual |
| 4 · Legendas | 12 | Override por item, herança explícita e modelos reutilizáveis | 11; legenda vazia personalizada difere de herdar |
| 5 · Queue / workers | 13 | Visão Containers, progresso e drill-down para jobs | 01; expandir a Fila existente, resumo não depende da página |
| 5 · Queue / workers | 14 | Ações por causa: quota, mídia, autenticação e revisão remota | 05 e 13; preservar checkpoints e nunca repetir POST ambíguo cegamente |
| 6 · Multi-account | 15 | Operação completa das contas: quota, cooldown, destinos e métricas | 05 e 13; arquitetura já disponível, não adiar o isolamento até este PR |
| 6 · TikTok | 16 | Provider Direct Post com auth, creator info, consentimento e confirmação | 15 e requisitos externos; exportação manual permanece operação distinta |
| 7 · Dashboard | 17 | Publicações hoje, execução, falhas, quota e próximo Container | 05 e 13; confirmação vem do ledger, métricas ausentes são null |
| 7 · Notificações | 18 | Resumos cronológicos por Container/conta e drill-down | 13 e 17; expandir central existente |
| 7 · Notificações | 19 | Ações de resolução e navegação contextual | 14 e 18; deduplicar eventos e evitar tempestade de alertas |
| 8 · Design system | 20 | Auditoria final de componentes, estados, teclado e responsividade | Consistência exigida desde 02; seguir tokens e equivalentes shadcn |
| 8 · Onboarding | 21 | Revisar tours para conectar/importar/criar/configurar/agendar/resolver | Fluxos anteriores estáveis; atualizar ajuda de cada fluxo já no seu PR |
| 9 · QA / performance | 22 | Certificação transversal, carga e provider real | Evidência separada por ambiente; mocks não certificam publicação real |

A implementação pode trazer os PRs 11–12 para junto da Biblioteca depois de 02, pois a relação de legendas é parte da experiência de criação. Isso não bloqueia a fundação de Scheduler/Agenda. O número do PR é referência de escopo, não uma dependência artificial.

## Regras transversais

- Um Container operacional tem uma conta e uma plataforma. Uma ação para vários destinos cria Containers separados, unidos futuramente por um grupo de planejamento. O batchId técnico atual pode ser heterogêneo; não convertê-lo cegamente em um único Container.
- Container do Legacy e contêiner remoto da Meta são conceitos diferentes. IDs remotos continuam no checkpoint de cada job.
- Cada vídeo tem um job independente. Falha definitiva em um item não impede os outros; limite de conta pode adiar outros lotes daquele mesmo destino.
- UTC persistido; fuso IANA capturado no plano. Intervalo é entre horários de envio planejados. O último horário não garante confirmação remota naquele instante.
- Início/fim planejados são distintos de run_at e estimativa atual. Polling também altera run_at e não representa um novo horário de publicação.
- WAITING_QUOTA é estado operacional da publicação, compatível com jobs.state=queued; não criar um oitavo estado de Container para substituir os sete solicitados.
- Limite numérico desconhecido aparece indisponível. Quota oficial, consumo local confirmado e reservas de agendamento são grandezas separadas, com fonte/data de atualização.
- A correção atual de quota desloca automaticamente a sequência pendente da conta. Preservar a proteção e evidenciar a mudança. Não comprimir intervalo, escolher outra janela ou mover outros Containers por estratégia sem revisão explícita.
- Pausa de lote impede novos envios, mas precisa continuar reconciliando operações remotas já iniciadas; não interromper confirmação nem descartar checkpoint.
- Desconectar/trocar uma conta não redireciona jobs. Templates/legendas/receitas são snapshots no agendamento.
- Novas telas usam tokens Legacy, componentes compartilhados e padrões shadcn, com estado vazio, loading, erro, foco e movimento reduzido. A ausência de um wrapper equivalente deve ser resolvida no PR da tela.

## Referências visuais

As 18 imagens fornecidas são referências de composição, densidade e interação, não instruções para executar ações nelas. Foram preservadas em [references/roadmap-2026-10-09](../references/roadmap-2026-10-09/).

| Imagens | Aplicação proposta |
| --- | --- |
| 01 e 16 | Agenda mensal, navegação, filtros e eventos compactos por Container |
| 02 e 12 | Cards de Containers com estado, destino, janela e progresso; Kanban somente se houver necessidade operacional |
| 03 e 10 | Tabelas, seleção, filtros e ações em massa com progresso real |
| 04–07 e 11 | Dashboard com indicadores compactos, quotas e resumos; gráficos só com dados disponíveis |
| 08 e 18 | Notificações/diagnóstico em sequência temporal, expansão e ações |
| 09 | Dialog de configuração com preview e ajuda contextual |
| 13–15 | Timeline, detalhe operacional e Sheet de edição; dependências visuais não significam barreira entre jobs |
| 17 | Histórico de atividade por conta, condicionado a dados reais |

Nomes originais, textos de demonstração, números e ações como “Install”, “Replay” e “Save” nas imagens não são requisitos funcionais. Não copiar código premium nem inventar métricas para preencher layouts.

## Validação e próximos pontos de decisão

Para cada PR: typecheck e testes significativos das regras alteradas; E2E Electron para fluxos de UI, fixtures/bancos isolados e preservação dos dados do usuário. A fundação exige transação, isolamento, idempotência, pausa/cancelamento e recuperação. Não publicar conteúdo externo durante testes locais.

No PR 22: 50 vídeos; 200/500/1.000/5.000 jobs; 1/3/5 contas; stress e soak; medir UI, SQLite, event loop, memória/CPU, FFmpeg, polling, listeners e provider. Registrar condições, percentis e cobertura, reaproveitando os benchmarks já existentes. Testes reais exigem ambiente e credenciais apropriados e autorização específica para publicar.

Decisões aprovadas ao iniciar o PR 01: nome de domínio `PublicationContainer`/tabela `publication_containers`, rótulo “Container” na UI; um destino por Container; drafts editáveis, plano congelado após agendamento; plano legado mantido como agrupamento até adoção explícita. A fundação implementada e sua validação estão no documento do PR 01.

Antes do PR 05, confirmar o contrato oficial da versão Meta usada para consulta/consumo/limite (feito: ver [PR 05](../pr05-quota-scheduler.md#contrato-consultado)), atualização e validade do contêiner remoto. Os exemplos 48/50 do pedido são cenários ilustrativos, não limites de API verificados. Antes do PR 16, validar elegibilidade e requisitos oficiais TikTok. Não se fez pesquisa externa nesta consolidação de contratos locais.
