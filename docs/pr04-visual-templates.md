# Templates visuais versionados — PR 04

Entrega no checkout em 2026-10-09, sobre os PRs 01–03. Especificação aprovada: [Visual Template Builder](specs/2026-10-09-pr04-visual-template-builder.md). O Scheduler quota-aware (PR 05) não foi iniciado.

## Fluxo

**Templates → Novo Template / Editar → preview → Salvar versão.** O editor tem duas colunas: propriedades (layout e formato, elementos, textos dinâmicos, capa e camadas herdadas do PR 03) e preview. Formatos 9:16, 4:5, 1:1, 16:9 ou dimensões pares entre 320 e 2.160 px, até 8 megapixels. Trocar o formato reescala a geometria proporcionalmente.

Elementos: mídia (uma por composição, `contain`/`cover` com alinhamento), logo/avatar, texto, watermark e banner com janela temporal. Cada um tem X/Y/largura/altura, opacidade, radius, borda e visibilidade, além de ordem explícita de camadas. No preview, clicar seleciona, arrastar move, a alça redimensiona e as setas movem (Shift para passos de 10 px). Os inputs numéricos continuam disponíveis para precisão. Fontes empacotadas: Inter, Roboto e Noto Serif. As composições iniciais (meme branco, meme dark, full screen, centralizado) são documentos editáveis; o renderer não tem ramos por preset.

Textos aceitam as variáveis literais `{{profile_name}}`, `{{username}}`, `{{caption}}` e `{{custom_text}}`, sem expressões ou HTML. Variáveis desconhecidas são recusadas. O editor avisa quando uma variável usada está vazia e quando um elemento visível ultrapassa o canvas (ele será recortado). Transbordamento de texto também gera aviso; a fonte nunca é reduzida automaticamente.

**Preview individual** mostra uma composição grande, com player local e seleção de quadro. **Preview em grade** mostra 3×3 com as mídias escolhidas da Biblioteca, uma por posição. Posições sem mídia ficam vazias, com ação para selecionar; nada é repetido ou inventado. A grade é identificada como simulação e não reproduz o recorte do Instagram. Selecionar mídias é somente leitura: não importa, altera nem cria jobs.

A lista de Templates mostra nome, descrição, identidade, versão e estado, com busca e filtro de arquivados. Ações: editar, duplicar (nova identidade, v1), arquivar/desarquivar e excluir com confirmação. O histórico abre versões anteriores; salvar a partir delas cria uma nova versão. Fechar com alterações pede confirmação. Leitura de PNG bloqueia **Salvar versão** e **Salvar rascunho** até terminar.

**Container → Configuração visual → Template visual → Aplicar Template ao rascunho → ajustar → Salvar rascunho → Revisar → Agendar.** Aplicar copia a versão para o Sheet, marca a origem ("Origem: Nome vN. Cópia independente.") e preenche `username` com a conta de destino. `caption` sai do contexto: vem da legenda efetiva de cada item. Ajustes posteriores ficam no rascunho e não alteram o Template.

## Persistência

Migration aditiva `0009`: `visual_templates` (identidade, status, versão atual, revisão), `visual_template_versions` (imutáveis, chave `workspace+template+versão`) e `visual_template_requests` (idempotência). Todo acesso filtra por `workspace_id`. Salvar cria a versão e atualiza a identidade numa transação IMMEDIATE. `expectedRevision` recusa edições concorrentes. Repetir um `requestId` com o mesmo conteúdo devolve o mesmo resultado; com outro conteúdo, é recusado.

O snapshot `{ version: 2 }` do Container carrega layout, contexto, origem informativa e as camadas do PR 03. Snapshots `{ version: 1 }` seguem o caminho anterior sem reinterpretação. Não há FK do Container para o Template: excluir ou arquivar a origem não afeta rascunhos nem agendados.

A cópia é feita no editor para permitir ajustes antes do primeiro salvamento. Por isso, `containers.create`/`updateDraft` verificam, na mesma transação, toda origem nova ou alterada: a versão precisa existir no workspace, estar ativa e ter o nome declarado. Origem forjada, de outro workspace ou arquivada entre a listagem e o salvamento desfaz a escrita inteira. Um rascunho que já tinha a origem continua editável mesmo após arquivar ou excluir o Template. `containers.applyTemplate` faz a mesma cópia no serviço, para integrações sem editor.

## Renderer e JIT

Preview e JIT usam o mesmo `paintElement` em Canvas, com as mesmas fontes, quebra de linha (`wrapText`, por grafema) e geometria (`fitRect`). Na publicação, o worker pede a rasterização ao processo principal. O main renderiza numa janela oculta própria, com sandbox, sem preload, Node, navegação ou credenciais, independente da janela principal. O FFmpeg recebe fundo, máscara de radius, borda e camadas PNG, e movimenta apenas a mídia, preservando áudio e duração.

O adapter processa uma composição por vez, com tempo limite de 45 s por pedido. Crash, travamento, falha de carga ou timeout descartam a janela e rejeitam só o pedido afetado; o seguinte cria uma janela nova. O worker trata a rejeição como falha transitória, então lease, checkpoints e receita permanecem e o retry reutiliza a mesma intenção. Encerrar o app descarta o adapter.

No agendamento, o contexto efetivo de cada item é resolvido e persistido na receita. Variável ausente impede o agendamento. Retry, cache e restart usam essa receita e o hash do snapshot congelado; não leem o Template, o nome atual da conta ou legendas editadas depois. A chave de cache inclui hashes do original e recursos, o snapshot e `RENDERER_VERSION`. O original nunca é escrito.

### Ajustes técnicos desta etapa

- **Posição da mídia no FFmpeg:** arredondar offset e tamanho separadamente podia passar 1 px do limite. Nesse caso, o `pad`/`crop` do FFmpeg recentraliza a mídia em silêncio (por exemplo, 10 px acima numa caixa de 136×97 alinhada embaixo), divergindo do preview. Offsets agora são limitados à caixa. Há teste de regressão que falha no código anterior.
- **Busca por nome:** `%`, `_` e `\` eram escapados sem cláusula `ESCAPE`, que o SQLite não assume por padrão; buscar "100%" não encontrava nada. Agora a cláusula é explícita.
- **Cache:** `RENDERER_VERSION` entrou na chave, para que mudanças futuras de layout ou fontes não reutilizem derivações antigas.

## Validação

- `npm run typecheck` e `npm run build`: aprovados.
- `npm test -- --maxWorkers=2`: 610 testes aprovados em 103 arquivos; 3 benchmarks opt-in ignorados.
- Testes com FFmpeg real: `contain`/`cover` com dimensões ímpares e alinhamentos extremos, máscara de radius, PNG com alpha a 50%, banner dentro e fora da janela, áudio e duração preservados.
- Adapter: timeout, crash, falha de carga, recuperação com janela nova, validação antes da janela e dispose.
- Serviço: versões imutáveis, replay idempotente, conflito de revisão, duplicar/arquivar/excluir sem afetar cópias, isolamento por workspace, rollback integral, zero FFmpeg/jobs no rascunho, contexto congelado por item, busca literal e verificação de origem.
- Electron E2E: Builder → versão → Container → snapshot congelado → JIT real → retry (mesmo após excluir o Template), com comparação de pixels preview × saída e original intacto. Também passaram Biblioteca/Containers, configuração visual do PR 03 e pipeline JIT. Contas sintéticas, datas futuras, banco temporário; nenhum provedor de publicação é chamado.

[Snapshot após agendamento](screens/qa-templates/after-snapshot.png).

A auditoria do PR 05 acrescentou lacre da receita, versão do renderizador e hash do original ao agendamento, e a conferência da intenção do job antes da API. Veja [PR 05 · Fase 1](pr05-quota-scheduler.md#fase-1--auditoria-do-snapshot-congelado).
