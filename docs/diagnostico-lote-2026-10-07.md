# Diagnóstico do lote com capas e banners

**Legacy 0.7.5 · 7 de outubro de 2026 · análise do painel aberto com 18 problemas.**

O maior problema observado é a codificação da versão com capa, não a quantidade de workers. Foram identificadas 13 tarefas de edição com a mesma família de erro. Em uma amostra real, a composição falhou com o encoder do Windows e funcionou tanto com normalização para 30 fps quanto com o encoder alternativo incluído no aplicativo.

Este documento registra o diagnóstico e o plano de correção. As reproduções geraram arquivos temporários; não reprocessaram publicações nem alteraram os vídeos originais. As correções propostas ainda não foram implementadas.

## 1. O que significa o contador 18

O painel combina problemas da sessão com tarefas que permanecem no estado de falha. Portanto, 18 não significa 18 causas independentes, 18 workers ou 18 vídeos sendo processados simultaneamente.

| Registros observados | Quantidade | Evidência | Interpretação |
|---|---:|---|---|
| Inserção de capa / codificação | 13 | Tarefas de edição falharam; mensagens citam `h264_mf`, falha ao abrir encoder e saída sem pacotes | Mesma família de falha na composição do vídeo |
| Publicação recusada | 2 | HTTP 400, código Meta 9 | Recusa da API; a causa específica exige subcódigo e contexto da operação |
| Conta conectada alterada | 1 | A revisão da conta de destino não corresponde à do agendamento | Proteção contra publicar na conta errada |
| Autenticação da sessão | 2 | Um registro HTTP 401 e outro de token inválido ou expirado | Podem ser dois registros da mesma operação; não devem ser apresentados como duas causas independentes |
| **Total do painel** | **18** | **16 tarefas com falha + 2 registros da sessão** | Instantâneo da análise; o contador pode mudar com novas operações |

A contagem das 16 tarefas persistidas foi confirmada com consulta somente de leitura à base local, além da leitura do próprio painel.

## 2. Causa reproduzida: encoder incompatível com a composição

### Comportamento atual

O aplicativo escolhe um encoder H.264 a partir de uma codificação curta e simples, com imagem sintética de 128 × 128. Depois guarda essa escolha em memória e a utiliza nos vídeos reais. A composição com capa concatena um frame de imagem ao vídeo e solicita saída com frequência de quadros variável.

O teste simples não exercita essa composição, os timestamps resultantes, a resolução real ou a presença de áudio. Passar nesse teste não garante que o encoder consiga processar o lote.

Referências: [seleção do encoder](C:/Users/noob7/Desktop/Legacy/src/main/media/ops.ts:26), [composição com capa](C:/Users/noob7/Desktop/Legacy/src/main/media/ops.ts:65), [configuração da saída](C:/Users/noob7/Desktop/Legacy/src/main/media/ops.ts:95).

### Reprodução em vídeo real

Foi usado um vídeo de uma das tarefas com falha: resolução 720 × 1280, aproximadamente 29,801 fps e áudio AAC. Os testes processaram apenas os primeiros dois segundos para isolar a inicialização do encoder.

| Experimento | Resultado | Saída validada |
|---|---|---|
| Capa + encoder `h264_mf` + saída VFR | **Falhou**: não conseguiu configurar o tipo de saída e abrir o encoder | Nenhum vídeo válido |
| Mesma composição + `libopenh264` + saída VFR | **Passou** | H.264, 720 × 1280, áudio AAC |
| Mesma composição + `h264_mf` + CFR a 30 fps e base de tempo compatível | **Passou** | H.264, 720 × 1280, 30 fps, áudio AAC |

Evidências salvas: [comparação dos encoders](C:/Users/noob7/Desktop/Legacy/docs/qa/diagnostico-lote/repro-vfr.json) e [normalização temporal](C:/Users/noob7/Desktop/Legacy/docs/qa/diagnostico-lote/repro-cfr.json).

**Conclusão comprovada:** o arquivo e a capa podem ser processados; a configuração atual não funciona com o encoder escolhido nessa amostra. A combinação de composição e parâmetros temporais é um fator relevante, pois a normalização resolveu a falha no mesmo encoder.

**Limite da conclusão:** isso não prova defeito no driver nem que todos os 13 vídeos tenham exatamente os mesmos parâmetros. É necessário validar a correção no conjunto completo, incluindo duração, primeiro frame e sincronização de áudio.

### Correção recomendada — P0

1. Normalizar timestamps e a frequência de quadros da composição para um perfil compatível com o encoder. A amostra validou 30 fps; não é necessário impor essa frequência indiscriminadamente a todos os vídeos.
2. Quando houver falha de inicialização ou incompatibilidade do encoder, tentar automaticamente outro encoder disponível, com limite de tentativas. O fallback deve acontecer na geração local, antes de qualquer publicação.
3. Evitar reutilizar uma escolha incompatível em todos os itens do lote. Registrar a falha por perfil de composição e selecionar uma alternativa para os itens semelhantes.
4. Renderizar em arquivo temporário. Validar vídeo, duração, resolução, áudio esperado e leitura do primeiro frame antes de registrar a versão pronta. Só então promover a saída para o arquivo final.
5. Preservar o original e descartar apenas saídas temporárias incompletas.

Retentar a mesma configuração várias vezes não corrige um erro determinístico de compatibilidade. O retry precisa mudar o perfil ou o encoder, ou interromper com uma orientação específica.

## 3. O lote não está sendo editado inteiro ao mesmo tempo

O código atual tem um único worker, que aguarda a execução de uma tarefa antes de buscar a próxima. No frontend, as imagens de capa e banner também são preparadas em laços sequenciais.

O problema de experiência é que o clique em Agendar engloba várias fases diferentes:

1. Extrair os frames necessários e renderizar as imagens de todos os vídeos.
2. Guardar as imagens preparadas em memória.
3. Salvar capas e enfileirar as versões editadas.
4. Registrar as publicações e navegar para a Fila.

A edição do vídeo ocorre no worker, mas a preparação das imagens acontece na tela antes de o agendamento ser registrado. Essas fases podem se sobrepor. Isso não equivale a cem encoders executando simultaneamente.

Referências: [preparação das imagens](C:/Users/noob7/Desktop/Legacy/src/renderer/features/compose/ComposePage.tsx:193), [enfileiramento das versões](C:/Users/noob7/Desktop/Legacy/src/renderer/features/compose/ComposePage.tsx:243), [agendamento das publicações](C:/Users/noob7/Desktop/Legacy/src/renderer/features/compose/ComposePage.tsx:280), [loop do worker](C:/Users/noob7/Desktop/Legacy/src/main/worker/worker.ts:54).

### Organização eficiente — P1

- Registrar rapidamente um lote com uma configuração imutável das edições escolhidas: capa, frame, texto, banner e intervalo. O trabalho pesado deve continuar fora da tela.
- Preparar cada item com memória limitada, liberando imagens intermediárias assim que forem persistidas. Evitar manter as imagens de cem vídeos simultaneamente no array de preparação.
- Reutilizar um frame quando capa e banner precisam da mesma posição. Para conhecer apenas a resolução, usar metadados já disponíveis, evitando uma extração desnecessária de imagem.
- Começar com uma renderização pesada por vez. Ampliar concorrência somente após medir consumo de memória, duração e estabilidade.
- Exibir fases separadas: **Lote registrado → Preparando capa → Renderizando vídeo → Pronto para publicar → Publicando → Confirmado**.
- Mostrar progresso por itens concluídos, como “12 de 100 preparados”, além da etapa do item atual. Percentual de bytes ou frames só deve aparecer quando realmente medido.
- Permitir cancelar ou pausar os itens ainda pendentes, preservando o trabalho já concluído.
- Reutilizar preparações concluídas ao retomar o lote. Uma nova tentativa não deve duplicar todas as capas e jobs anteriores.

## 4. Dependência entre edição e publicação — P0

O agendamento aceita uma versão que ainda está representada por um job de edição pendente. Porém, quando a publicação executa, ela exige que essa versão já exista. Se a edição falhar, a publicação pode continuar agendada e depois falhar por versão ausente.

Isso é uma fragilidade comprovada no fluxo do código; não foi contabilizado como causa adicional dos 18 registros observados.

Referências: [aceitação da edição pendente](C:/Users/noob7/Desktop/Legacy/src/main/services/instagram-publishing.ts:106) e [exigência da versão pronta](C:/Users/noob7/Desktop/Legacy/src/main/services/instagram-publishing.ts:157).

**Solução:** registrar uma dependência explícita entre o job de publicação e a versão editada. O worker só pode executar a publicação quando a preparação estiver concluída e validada, independentemente da prioridade ou do horário.

Se a edição falhar, a publicação deve ficar bloqueada com “Aguardando correção da mídia”, indicando o vídeo e a tarefa responsável. Essa espera não deve consumir tentativas de publicação nem enviar a mídia original silenciosamente.

Ao corrigir e retomar a edição, desbloquear a publicação correspondente. Se o horário já passou, informar a situação e aplicar uma política explícita de reagendamento, evitando uma rajada automática de publicações atrasadas.

## 5. Autenticação, destino e recusas da API

### Token inválido ou expirado

Os registros do painel comprovam uma falha de autenticação. Antes de iniciar um lote grande, validar a conexão de destino e apresentar uma ação clara de reconexão. Uma validação recente pode ser reutilizada por um prazo curto; a API ainda pode revogar o acesso depois disso.

Quando a autenticação falhar durante a execução, bloquear os itens pendentes dessa conta e pedir reconexão. Não tentar repetir a mesma requisição em todos os vídeos. Preparações locais válidas devem ser preservadas.

### Conta conectada alterada

A verificação de revisão do destino é uma proteção correta e deve permanecer. Trocar a conta ativa não pode redirecionar silenciosamente publicações antigas.

A interface deve oferecer revisão do lote, mostrando destino anterior, destino pretendido e horários. Atualizar o token da mesma conta deve preservar a identidade do destino; reconectar uma conta diferente exige confirmação de novo destino.

### HTTP 400 / código Meta 9

Os dois jobs persistidos guardam uma mensagem genérica. Não há evidência suficiente nesses registros para atribuir a causa específica a permissão, cota ou outro limite. A documentação oficial não pôde ser consultada nesta análise; não foi adotado um limite numérico de publicação por suposição.

O cliente já captura alguns detalhes da resposta para o diagnóstico da sessão, mas a exceção utilizada pela tarefa reduz esses dados ao status e código principal. É necessário persistir de forma sanitizada: provider, operação, status HTTP, código, subcódigo, indicação de erro transitório e referência de rastreio.

Com esses dados, classificar as ações:

- **Autenticação:** reconectar a conta e manter o lote bloqueado até validação.
- **Permissão ou configuração:** apresentar a correção exigida; repetir sem alteração não ajuda.
- **Limite transitório ou cota confirmada:** aguardar a janela adequada e informar o próximo horário elegível.
- **Conteúdo inválido:** corrigir o vídeo correspondente.
- **Resposta de publicação incerta:** consultar o checkpoint existente antes de qualquer repetição, preservando a proteção contra duplicidade.

O comportamento atual considera qualquer falha de publicação definitiva. Uma revisão dessa política precisa distinguir erros transitórios sem remover a proteção para respostas incertas: [tratamento das falhas](C:/Users/noob7/Desktop/Legacy/src/main/worker/handlers.ts:106).

## 6. Ajustes de diagnóstico e layout — P1

### Mostrar causas compreensíveis

Hoje, a mensagem de FFmpeg contém endereços de memória e apenas o final da saída de erro. A reprodução revelou que a mensagem inicial explica melhor a falha: o encoder não conseguiu configurar a saída.

Apresentar no painel: **“Falha ao gerar a versão com capa — configuração de vídeo incompatível com o encoder.”** Em seguida, mostrar mídia, lote, etapa e próxima ação. O log técnico completo deve ficar em uma expansão ou detalhe lateral.

Preservar um resumo inicial e o final do erro, além do log sanitizado quando necessário. Referência: [truncamento atual](C:/Users/noob7/Desktop/Legacy/src/main/media/run.ts:21).

### Separar incidentes de ocorrências

- Agrupar as 13 falhas de edição por uma assinatura estável, ignorando endereços de memória e identificadores variáveis.
- Exibir “1 causa de codificação · 13 tarefas afetadas”, mantendo acesso a cada tarefa.
- Relacionar o erro de rede e o erro da operação quando forem a mesma falha de autenticação.
- Distinguir problemas da sessão, falhas históricas e tarefas atualmente bloqueadas.
- Classificar tarefas de edição persistidas em Processamento, em vez de deixá-las sob a última categoria dos eventos da sessão.

### Restringir operações em massa ao estado correto

Foi observado um grupo de 25 tarefas canceladas selecionadas, com Executar agora, Cancelar, Reprocessar e Alterar prioridade ainda disponíveis na barra. O backend rejeita ações incompatíveis, mas a interface permite iniciar uma operação sem utilidade.

Desabilitar ações sem itens elegíveis e explicar o motivo. Em seleções mistas, mostrar quantos itens serão alterados antes da confirmação. Manter a validação por estado e revisão no backend.

Referência: [barra de operações em massa](C:/Users/noob7/Desktop/Legacy/src/renderer/features/queue/QueuePage.tsx:115).

## 7. Ordem recomendada de implementação

| Prioridade | Entrega | Resultado esperado |
|---|---|---|
| P0 · 1 | Normalização temporal, fallback de encoder e validação da saída | Resolver a família dominante de falhas de capa |
| P0 · 2 | Dependência explícita edição → publicação | Impedir envio antes da mídia estar pronta |
| P0 · 3 | Bloqueio por autenticação/destino e classificação persistente da resposta da API | Evitar repetição inútil e publicação no destino errado |
| P1 · 4 | Registro rápido do lote, processamento fora da tela, retomada e progresso por itens | Tornar lotes grandes previsíveis e controláveis |
| P1 · 5 | Agrupamento de causas, mensagens acionáveis e ações em massa elegíveis | Facilitar diagnóstico e recuperação |

## 8. Critérios de aceitação

1. Uma amostra do erro original termina com vídeo válido após normalização ou fallback; capa e áudio são conferidos, não apenas o código de saída do processo.
2. A validação cobre os 13 arquivos afetados e vídeos com áudio, sem áudio, rotação, formatos de quadro diferentes e fps fracionário.
3. Um lote de 100 itens mantém a interface responsiva e limita a quantidade de renderizações pesadas simultâneas.
4. Reabrir o aplicativo permite retomar o lote sem recriar versões já prontas.
5. Nenhuma publicação executa com sua dependência pendente, falha ou cancelada, mesmo após alterar prioridade.
6. Token inválido interrompe novas tentativas da conta; reconexão mantém mídia e preparação já concluídas.
7. Trocar de conta não altera silenciosamente o destino dos agendamentos existentes.
8. Erros transitórios mostram próximo horário de tentativa; publicação incerta consulta o checkpoint antes de repetir.
9. Ações em massa sem itens elegíveis ficam indisponíveis e seleções mistas mostram o alcance real da operação.
10. O painel apresenta a causa principal, itens afetados e ação sugerida; detalhes técnicos continuam acessíveis.

**Validação realizada nesta análise:** leitura dos 18 registros do painel, conferência das 16 falhas persistidas, rastreamento dos fluxos de preparação/publicação e três experimentos de codificação em uma amostra real. Não foi realizado novo envio ao Instagram.
