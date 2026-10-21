# Diagnóstico técnico do Legacy

O rodapé inicia recolhido. **Diagnóstico** abre Console, Network, Problemas, Fila e Processador. A tab e a altura são mantidas neste computador. O handle aceita arraste e as teclas ↑/↓, Home/End.

O console mantém os últimos 2000 eventos da sessão, com timestamps ISO, nível, origem, provider e IDs. Eventos idênticos consecutivos aparecem agrupados; a expansão preserva horários, tarefas e tentativas. A busca considera também os campos estruturados e abre o resultado selecionado. Enter/Shift+Enter e os botões ↑/↓ navegam. Pausar congela apenas a visualização; a captura continua. Limpar afeta somente os eventos visíveis.

Network observa os clientes HTTPS de Instagram, Apify, downloads e webhooks, além dos canais IPC do Legacy. IPC usa OK/Falha IPC, sem inventar status HTTP. Lentos significa mais de 3 segundos. As durações de respostas completas incluem a transferência; erros HTTP são registrados ao receber o status. Request IDs locais correlacionam eventos. Somente campos permitidos da resposta de erro Instagram (código, subcódigo, tipo e trace ID) são capturados. Tokens, headers, parâmetros de URL e corpos externos arbitrários são omitidos.

Problemas agrupa ocorrências da sessão por categoria e inclui até 500 falhas persistidas. Abrir tarefa navega para os detalhes existentes, com vídeo, origem e tentativas. A fila é paginada em blocos de 100 e usa contadores globais. Retrying deriva de tarefas queued com tentativas anteriores; Preparing, Uploading, Publishing e Waiting provider derivam dos checkpoints gravados. Confirmed exige publicação confirmada; exportação manual TikTok permanece Completed.

O heartbeat é enviado pelo processo worker a cada 2 segundos. Acima de 10 segundos sem heartbeat, a saúde indica Offline. A existência do processo e os contadores permanecem visíveis no rodapé. A latência média usa chamadas HTTPS da sessão; falhas recentes consideram os últimos 5 minutos.

**Exportar** abre a janela nativa para salvar JSON com todos os eventos retidos, toda a fila, checkpoints e saúde do worker. **Copiar** inclui os eventos visíveis e a página atual da fila. A sanitização ocorre antes do IPC e antes de salvar; também mascara valores de credenciais conhecidas em textos e stacks. Não são capturados payloads de jobs nem corpos de requisição.

Arquivos centrais: `src/shared/diagnostics.ts` (contrato e sanitização), `src/main/diagnostics.ts` (captura, contexto assíncrono e transporte), `src/main/worker/handlers.ts` (estados), `src/renderer/components/DiagnosticPanel.tsx` (interface). O canal `diagnostics.snapshot` permite inspecionar dados reais via bridge; `diagnostics.export` gera um arquivo para Claude Code/Codex.

A instrumentação não altera os critérios de conclusão: timeout, conexão perdida, resposta vazia e polling atrasado não produzem sucesso. O worker mantém a publicação em execução até confirmação ou falha terminal.
