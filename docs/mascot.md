# Identidade e controlador do mascote Legacy

O símbolo L foi substituído pelo personagem, preservando a assinatura `legacy.`. SVG/CSS mantém transparência e escala, sem GIFs, WebGL ou uma dependência de animação. Não há arquivo Rive autorado no projeto; um runtime Rive não acrescentaria comportamento à arte SVG existente.

## Arquitetura

- `src/renderer/components/brand/LegacyMascot.tsx`: desenho, expressões, acessórios e assinatura.
- `MascotProvider.tsx`: contexto por workspace, fila e notificações React Query, eventos `jobs.changed`, inatividade e reações temporárias.
- `status.ts`: seleção determinística da expressão e mensagem; prioridade independente da ordem das tarefas.
- `activity.ts`: acompanha chamadas IPC explicitamente mapeadas, com identificação da operação e workspace. Chamadas concorrentes se encerram individualmente; a inscrição recupera operações ainda ativas. Nunca guarda parâmetros, arquivos ou credenciais.
- `motion.ts`: cursor e iluminação via requestAnimationFrame e propriedades SVG/CSS, sem setState por frame. Apenas sidebar e dashboard acompanham o cursor.
- `preferences.ts` / `BrandPanel.tsx`: prévia independente dos estados reais, visual salvo e controle de animação.

Sidebar, dashboard e rodapé compartilham o controlador. O rodapé usa expressão estática para não multiplicar animações. O logo da sidebar abre uma mensagem contextual por clique/teclado; Escape e perda de foco fecham. A navegação continua nos links do menu.

## Fontes dos estados

| Fonte real | Estado |
| --- | --- |
| Processador indisponível ou consulta da fila falhou | error, com explicação |
| Tarefa failed | error; rate_limit somente com resposta explícita |
| Revisão de lote / confirmação de agendamento abertas | approval |
| Formulário de quantidade de downloads ou link de reel | question |
| Resposta HTTP 429, rate_limit, too many requests ou mensagem explícita de limitação | rate_limit |
| publish_instagram executando | publishing |
| download_reel executando | downloading |
| fetch_profile executando | searching |
| Thumbnail, banner, exportação, webhook executando | working |
| Importação de métricas em andamento | thinking |
| Importação de caminhos / preparação de lote | working |
| Consulta da grade de posts em andamento | searching |
| Tarefa queued, já no horário | waiting |
| Tarefa queued aguardando retry | waiting ou rate_limit; horário extraído de runAt |
| Somente tarefas futuras | idle, com quantidade de agendamentos |
| Nova conclusão observada na sessão | finished por 650ms |
| Nova conquista reconhecida | proud com coroa por 1,6s |
| Nova notificação, após o carregamento inicial | notification por 900ms |
| Sistema reporta ausência de rede, sem atividade prioritária | offline; operações locais continuam disponíveis |
| Abertura / retorno após descanso | greeting por 1s / 900ms |
| Dois minutos sem interação nem operações ativas | sleeping |

Prioridade: error > approval > question > rate_limit > warning > publishing > upload > downloading > working > searching > thinking > waiting > offline > finished > proud > notification > greeting > wink > idle > sleeping. A falha não pode ser ocultada por hover ou uma conquista.

Histórico concluído na primeira consulta não gera comemoração. Eventos e consulta são deduplicados; a conclusão espera o fim da atividade em execução. Um agendamento não representa publicação realizada. A confirmação de gravação do agendamento é uma reação breve, depois idle. Nenhuma expressão muda aleatoriamente para sugerir trabalho.

`upload` é uma variante visual disponível para operações que informem envio. O backend atual expõe a publicação como um único job: o controlador usa publishing, sem fabricar subetapas de preparação, upload ou confirmação da plataforma. TikTok continua sendo exportação para postagem manual. O seletor nativo e a importação escolhida compartilham um IPC; sua expressão permanece question até a chamada retornar, enquanto a importação por caminhos usa working. Os resultados parciais de importação geram warning, e cancelar um seletor não gera sucesso.

O mascote não altera política de retry, nem promete uma nova tentativa para tarefas definitivamente falhadas. Rate limit usa sinais explícitos presentes no erro: referências genéricas a permissões ou limites não são suficientes. `runAt` só é apresentado como próxima tentativa quando a tarefa continua queued.

## Movimento e acessibilidade

- Inclinação máxima de 2°/3°, olhos até 3px/2px, corpo até 1px e sombra até 2px.
- Reação interativa com cooldown de sete segundos; não substitui estados prioritários.
- `prefers-reduced-motion` e preferência local removem movimento e parallax, preservando expressões e mensagens.
- Visibilidade do documento pausa movimentos; IntersectionObserver pausa instâncias fora da área visível.
- Toasts, erros de inicialização, carregamento de mídias, estados vazios e tutorial usam o personagem com texto real. A expressão não substitui mensagens, contadores ou progresso.
- Acessórios personalizados continuam salvos. A coroa é aplicada temporariamente em conquistas; não há datas de aniversário, feriados ou desbloqueios inventados.

## Ícones

`resources/mascot.svg` é a versão simplificada em fundo transparente para tamanhos pequenos. `scripts/build-brand-icons.mjs` gera `tray.png` (32px), `icon.png` (256px) e `icon.ico` (16, 24, 32, 48, 64, 128 e 256px). O script usa Edge headless via Playwright; `LEGACY_ICON_BROWSER=chrome` permite Chrome instalado.

`BrowserWindow` recebe o ICO; a bandeja recebe o PNG; notificações nativas recebem o ícone grande. O favicon usa SVG empacotado pelo Vite. `electron-builder.yml` aplica o ICO ao executável Windows e inclui os arquivos em resources. Para atualizar um aplicativo já instalado, é necessário gerar e instalar a nova distribuição; alterar o código não substitui uma instalação existente.

## Verificação

`brand.test.tsx` cobre prioridade, agendamento futuro, erro/limite, preferências e IDs SVG. `MascotProvider.test.tsx` cobre conclusão nova versus histórica, concorrência, cancelamento, isolamento de workspace, cooldown, descanso e notificações. `tests/e2e/brand.spec.ts` exercita Electron/IPC/SQLite com dados isolados, verificando sincronia dos mascotes, processamento, sucesso, erro, retry, persistência, cursor, redução de movimento, janela oculta e sidebar recolhida.
