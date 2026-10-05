# Legacy

**Seu estúdio de conteúdo, direto no desktop.**

![Versão 0.2.0](https://img.shields.io/badge/vers%C3%A3o-0.2.0-6366f1)
![Windows x64](https://img.shields.io/badge/plataforma-Windows%2010%2F11-0078d4)
![Electron e React](https://img.shields.io/badge/Electron%20%2B%20React-desktop-22c55e)

O Legacy reúne pesquisa de perfis, downloads de reels públicos via Apify, biblioteca de vídeos, preparação de lotes, legendas, métricas e uma fila persistente. Um aplicativo Electron com Node.js para organizar a produção de conteúdo com dados armazenados no seu computador.

**Idealização, direção do produto e autoria: [Eduardo Ximenes — @wineerx](https://github.com/wineerx).** Implementação realizada com assistência do Codex.

![Painel do Legacy: tarefas, perfis, métricas e integrações em uma interface escura](docs/screens/visao-geral.png)

*Captura real do Legacy 0.2.0 com dados de teste. Valores indisponíveis permanecem como “—”.*

## O que você pode fazer

| Recurso | Uso |
| --- | --- |
| Perfis e downloads | Cole uma URL Instagram, defina um limite e acompanhe os downloads via Apify. |
| Biblioteca | Importe vídeos, evite duplicados e navegue em uma grade 9:16. |
| Preparação de lotes | Ajuste legendas, capas e banners antes de exportar. |
| Painel e métricas | Acompanhe tarefas, perfis e métricas conhecidas, com indicação da cobertura. |
| Legendas | Use modelos editáveis ou compare legendas de reels carregados por métricas disponíveis. |
| Armazenamento | Escolha a pasta dos novos vídeos por workspace. |
| Avisos e webhooks | Receba notificações locais e configure entregas HTTPS assinadas, inicialmente desativadas. |
| Tutoriais | Siga tours com foco, destaque, navegação suave e retomada do progresso. |

A publicação oficial no Instagram, OAuth, licença e TikTok por API ainda estão no [roadmap](docs/roadmap.md). A exportação atual é assistida, com publicação manual.

## Comece por aqui

1. Abra o Legacy e siga **Visão geral → Tour do Legacy**.
2. Em **Configurações**, escolha onde guardar os novos vídeos.
3. Importe vídeos na **Biblioteca**, ou configure Apify e adicione uma URL em **Perfis**.
4. Selecione um lote e abra **Criar postagem** para ajustar capa, banner e legendas.
5. Acompanhe a **Fila**, revise a exportação e publique pela plataforma oficial.
6. Use **Tutoriais** para salvar seu plano de perfil e explorar os modelos de legenda.

[Downloads por perfil](#downloads-por-url-de-perfil-instagram) · [Integrações](#visão-geral-e-integrações) · [Webhooks](#notificações-e-webhooks) · [Tutoriais](#tutoriais-e-legendas) · [Instalação](#instalação-e-atualizações)

## Requisitos

- Windows 10/11 x64
- Node 24
- Build Tools do Visual Studio (C++) apenas se o rebuild do SQLite falhar. Com Electron 42 e better-sqlite3 12.11.1 existe binário pré-compilado, então normalmente não é preciso.

## Comandos

```
npm i                 # instala e recompila better-sqlite3 para o Electron
npm run fetch:ffmpeg  # baixa o FFmpeg LGPL fixado e confere o sha256
npm run dev           # abre o app em modo desenvolvimento
npm test              # Vitest sob Electron (ELECTRON_RUN_AS_NODE)
npm run typecheck     # tsc dos projetos node e web
npm run e2e           # build + Playwright (Electron)
npm run dist          # instalador NSIS em dist/ (sem assinatura se CSC_LINK não estiver definido)
```

## Pasta de dados

- Padrão: `%APPDATA%/Legacy`. Alternativa: variável `LEGACY_DATA_DIR`.
- Em **Configurações → Armazenamento dos vídeos**, use **Alterar pasta dos vídeos** ou **Restaurar pasta padrão**. A escolha é persistida por workspace; o destino personalizado usa `<pasta escolhida>/Legacy/<workspace>/media`.
- A troca vale para novas importações/downloads. Arquivos existentes permanecem no local original, incluindo miniaturas e versões editadas, e continuam acessíveis. Não há migração automática. Mantenha unidades externas conectadas.
- Banco, capas de modelo, temporários e exportações permanecem na pasta de dados.
- Backup: feche o app e copie a pasta de dados **e todas as pastas personalizadas usadas**. Restaurar: recoloque nos mesmos caminhos, com o app fechado.

## Downloads por URL de perfil (Instagram)

1. Na **Visão geral → Configurar Apify**, cadastre sua chave e clique em **Testar chave salva**. O teste consulta a conta sem iniciar um Actor pago. A chave é protegida pelo Windows e aplicada ao worker sem reiniciar. Alternativa: variável de ambiente `APIFY_TOKEN`; `.env.example` é referência e não é carregado automaticamente. Nunca use `VITE_APIFY_TOKEN`.
2. Abra **Perfis**, cole `https://www.instagram.com/usuario/` e clique em **Adicionar perfil**.
3. Clique em **Baixar vídeos do perfil**, escolha de 1 a 100 reels e **Buscar e baixar**. A operação usa o serviço pago Apify conforme o saldo/plano da sua conta.
4. Acompanhe a busca e cada download na **Fila**. Os arquivos validados aparecem na **Biblioteca**; os posts preservam legenda, link original e métricas disponíveis.

Implementação: Node.js no worker do Electron, API REST do Actor `apify/instagram-reel-scraper`. Chaves cadastradas são criptografadas com safeStorage/DPAPI no banco; a interface recebe somente estado e data de validação, sem ler a chave de volta. O worker recebe as credenciais em memória pelo processo principal. Não exige senha do Instagram. A busca de reels públicos depende da disponibilidade do provedor; não cobre TikTok, perfis privados nem garante todos os vídeos de um perfil. Filtros/seleção da grade não afetam a busca. Métricas ausentes ficam indisponíveis; `videoViewCount` não é substituído por reproduções.

## Visão geral e integrações

A Visão geral reúne indicadores clicáveis de tarefas, fila, falhas, perfis, vídeos guardados e notificações, atualizados a cada cinco segundos. A tabela de perfis mostra somas das métricas conhecidas e a cobertura (quantos posts têm o valor disponível). Um conjunto sem dados exibe `—`, preservando zeros reais. Os números são dos posts carregados no workspace, não o total do perfil na rede social.

**APIs, notificações e webhooks** também está em Configurações. Apify tem cadastro, remoção e teste da chave. Instagram oficial e TikTok por API mostram as dependências ainda não implementadas; guardar uma chave Apify não conecta essas plataformas para publicação.

## Notificações e webhooks

Alertas configuráveis: conclusões de tarefas, falhas e avisos do Windows. Miniaturas concluídas não geram avisos. A central interna possui leitura individual e em lote; alertas nativos dependem das permissões e do modo Não perturbe. Avisos pendentes são agrupados por workspace, com verificação a cada 30 segundos. O botão **Criar notificação de teste** permite conferir o comportamento.

Webhooks são **de saída**, desativados por padrão conforme solicitado. Para ativar, informe um domínio HTTPS público na porta padrão, sem query/credenciais, um segredo de pelo menos 32 caracteres e os eventos `job.done`/`job.failed`. Salve antes de enviar um teste. O histórico mostra as últimas 20 entregas. Não há listener público nem recebimento de webhooks Meta/TikTok nesta versão.

Cada evento contém ID, tipo, data UTC, workspace e ID/tipo/estado/tentativa da tarefa. Não inclui token, vídeo, legenda, URL de mídia ou caminho local. O receptor verifica os cabeçalhos `X-Legacy-Event-Id`, `X-Legacy-Timestamp` e `X-Legacy-Signature`:

```text
X-Legacy-Signature = sha256=<HMAC-SHA256(segredo, timestamp + "." + corpo JSON bruto)>
```

Compare assinaturas em tempo constante, valide a idade do timestamp e deduplique pelo ID do evento. As entregas têm até cinco tentativas com backoff, respeitam Retry-After para HTTP 429/5xx, recusam redirects e redes privadas, e expiram após 15 segundos por requisição. Troca de destino, segredo ou ativação invalida envios antigos. Uma requisição já enviada não pode ser retirada; não se promete exactly-once. Falha em webhook não gera outro webhook recursivamente.

## Tutoriais e legendas

**Visão geral → Tour do Legacy** ou **Tutoriais → Iniciar tour do Legacy** abre um tour de 12 passos com foco no popup, destaque do controle, navegação suave, retorno/avanço e pausa com Escape. O progresso é salvo por workspace no navegador local. Em Tutoriais, retome ou reinicie. A preferência de movimento reduzido do Windows/navegador é respeitada.

O **guia de perfil** tem oito passos, um plano editável (tema, público, bio e cadência) salvo no workspace e as seis referências indicadas. Adicionar uma referência cadastra apenas o link. A criação da conta acontece no Instagram oficial; o Legacy organiza pesquisa, biblioteca, edição, exportação, lembretes e análise. O guia não garante crescimento ou alto engajamento.

**Legendas do Legacy** aparece no editor, nos perfis e nos tutoriais como uma faixa horizontal. Modelos prontos são sugestões editáveis, sem validação de resultado; substitua os campos entre colchetes. No editor, **Usar modelo** preenche a legenda base. **Reels em destaque** lista até 20 legendas dos posts realmente carregados, ordenadas por visualizações, curtidas ou comentários, preservando fonte e link original. Posts sem legenda ou sem a métrica escolhida não entram no ranking.

Não foi possível ler os perfis de referência diretamente pelo Instagram durante a implementação; não foram inventadas legendas, números ou rankings. A lista de conteúdos reais será preenchida pela Apify configurada ou por CSV/JSON importado. A posição no ranking do reel não prova que sua legenda causou o engajamento.

## Instalação e atualizações

Versão local: **0.2.0**. Há instalador NSIS para Windows, gerado por `npm run dist`. A atualização é manual: feche o Legacy, execute o instalador da nova versão e reabra. Os dados ficam fora da pasta do aplicativo. Faça backup antes de trocar instalação ou computador.

Ainda não há auto-update: `publish: null` e nenhum servidor de releases está configurado. Para distribuir atualizações automáticas futuramente, será necessário definir o canal/servidor de releases, mecanismo de update compatível com NSIS e assinatura do instalador. Credenciais criptografadas podem exigir novo cadastro após migrar para outro usuário ou computador Windows.

A fila persiste após reinício, salva o ID da execução remota e deduplica arquivos por SHA-256 no workspace. Cada arquivo tem até três tentativas, limite de 1 GiB e timeout de cinco minutos. Links expirados exigem nova busca. Tarefas ainda na fila podem ser canceladas; uma execução já iniciada termina ou expira. Se a resposta de criação da execução Apify se perder, confira o console Apify antes de iniciar outra busca: o app não repete uma cobrança potencialmente aceita.

O fluxo foi implementado para a [API Apify](https://docs.apify.com/api/v2) e o [contrato do Actor](https://apify.com/apify/instagram-reel-scraper/input-schema), consultados em 2026-10-05. Integração externa não validada com credencial real nesta entrega.

## Limitações

- O agendamento e os lembretes só rodam com o PC ligado e o app aberto (ele continua na bandeja ao fechar a janela).
- TikTok é manual: o app prepara a pasta (vídeo, capa, legenda) e cria um lembrete.
- Conexão e publicação oficiais do Instagram continuam previstas para a fase B. Downloads de reels públicos via Apify são uma integração separada; links adicionados manualmente continuam referências.
- O instalador sai sem assinatura de código; o SmartScreen avisa na instalação.

## Documentação

- [Arquitetura e processos](docs/architecture.md)
- [Design system](docs/design-system.md)
- [Segurança, dados e credenciais](docs/security.md)
- [Capacidades e limitações das plataformas](docs/platform-capabilities.md)
- [Decisões técnicas](docs/decisions/)
- [Roadmap](docs/roadmap.md)
- [Progresso e verificações](docs/progress.md)

## Qualidade e desenvolvimento

Stack: Electron 42.11.10, Node.js 24, React 19, TypeScript, SQLite/Drizzle, TanStack Query e FFmpeg LGPL. Renderer isolado e sem acesso direto ao Node; operações passam por contratos IPC validados, processo principal e worker.

Verificação da versão 0.2.0: **273 testes unitários e de integração**, **11 testes E2E no Electron** e typecheck concluídos. Testes de Apify e webhook usam rede simulada; integração externa com credencial real permanece pendente.

Para contribuir, descreva o problema, mantenha o isolamento por workspace e execute `npm run typecheck`, `npm test -- --maxWorkers=2` e os E2E pertinentes. Não inclua tokens, bancos locais, vídeos pessoais ou pastas de dados no Git.

## Créditos

**Eduardo Ximenes (@wineerx)** é o idealizador e autor do projeto Legacy, responsável pela visão do produto, requisitos e direção das funcionalidades. Desenvolvimento com assistência do Codex. As bibliotecas e ferramentas utilizadas mantêm suas próprias autorias e licenças; consulte suas distribuições para os termos correspondentes.

As referências Instagram no guia foram indicadas para estudo. Elas não representam parceria, endosso ou autoria do Legacy, e suas legendas não foram reproduzidas nesta documentação.

