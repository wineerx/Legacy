# Configuração visual por Container — PR 03

Entrega no checkout em 2026-10-09, sobre os contratos dos PRs 01 e 02. Templates completos continuam no PR 04.

## Fluxo

Na Biblioteca, criar ou reabrir um Container em rascunho e expandir **Configuração visual** no mesmo Sheet. Ativar as camadas desejadas:

- **Marca d’água:** PNG, cinco posições, tamanho entre 1% e 50% da largura e opacidade entre 0% e 100%. Mantém proporção, limita altura a 45% do quadro e usa margem de 2% do menor lado.
- **Banner:** PNG com transparência, sobre o quadro inteiro, entre os instantes configurados. O banner do Container respeita a janela, inclusive quando começa depois do primeiro quadro.
- **Capa:** PNG inserido como um quadro de 33 ms antes do vídeo, com preenchimento e recorte central. A marca d’água também aparece sobre a capa.

PNG de até 1 MB por camada, até 4.096 pixels por lado e 16 megapixels. Os controles reutilizam Input, Select, Toggle, Field, CollapsibleCard e Sheet do design system. A composição segue as referências de [Switch](https://ui.shadcn.com/docs/components/radix/switch) e [Collapsible](https://ui.shadcn.com/docs/components/radix/collapsible) do shadcn.

A prévia usa o vídeo local e imagens sobrepostas no browser. Posição, dimensões e opacidade usam a mesma geometria do FFmpeg. Capa, janela do banner e overrides individuais também aparecem na prévia. Não é uma transcodificação: cor/compressão podem variar e a capa não acrescenta 33 ms à timeline do player local. O resultado final acrescenta esse quadro e preserva o áudio com o deslocamento existente.

**Salvar rascunho → Revisar rascunho → Agendar Container**. A revisão oferece os controles existentes de data/horário e intervalo, com fuso do workspace. Mudanças precisam ser salvas antes de agendar. Após agendamento, conteúdo e configuração ficam bloqueados. Ler uma imagem bloqueia salvar/fechar até a leitura terminar, evitando salvar uma configuração parcial.

## Persistência e JIT

`visual_snapshot_json` guarda o snapshot integral, incluindo PNGs em data URLs, sem dependência dos arquivos que o usuário selecionou. O formato `{ version: 1 }` anterior permanece válido. Não há migration nova: a coluna já existe no PR 01.

`containers.create`/`updateDraft` continuam responsáveis pela escrita integral e atômica. Rascunho não grava derivação, receita nem job, e não executa FFmpeg/FFprobe. O novo canal `containers.previewOverrides` é uma consulta somente de leitura, validada e limitada ao workspace/asset.

Na transação IMMEDIATE de `schedule`, cada item com configuração ativa recebe uma intenção JIT em `media_versions`, sem criar arquivos ou jobs de processamento. Cada publicação mantém seu job independente. A receita aponta ao Container e ao SHA-256 do snapshot congelado. O snapshot efetivo do item referencia essa receita e hash, evitando copiar imagens para milhares de itens. Qualquer erro posterior desfaz receitas, jobs e snapshots da transação inteira. Repetir o agendamento com a mesma revisão retorna os mesmos jobs e não cria receitas extras.

O JIT confere o snapshot congelado antes de usar a receita, mesmo em cache hit. Materializa as imagens em arquivos temporários apenas no momento de derivar, compõe em uma codificação, valida a saída e reutiliza o cache existente com hash/manifest. Limpa MP4/PNGs parciais no finally; a limpeza de startup existente cobre interrupções abruptas. Retry usa a mesma receita e snapshot. O original é lido, nunca sobrescrito.

Watermark desativado ou com opacidade zero, sem outras camadas, mantém o caminho original e não gera receita adicional. Uma receita individual existente continua sendo usada nesse caso. Com camadas comuns ativas, overrides individuais de banner/capa têm prioridade por camada. Uma versão individual já renderizada continua como fonte; não reaplica banner/capa comuns sobre sua edição pronta, mas permite a watermark comum. O `recipeVersionId` original do item é preservado; a receita efetiva fica no snapshot/job.

Gates de pausa/cancelamento, checkpoints, leases, idempotência de publicação, quota por conta e reconciliação remota permanecem no pipeline dos PRs anteriores. Não converte lotes legados, cria templates, acrescenta watermark ao arquivo original ou publica conteúdo durante os testes.

## Validação

- `npm run typecheck` e `npm run build`: aprovados.
- `npm test -- --maxWorkers=2`: 586 testes aprovados, 3 benchmarks opt-in ignorados, 96 arquivos aprovados.
- Após os ajustes finais, regressão direcionada: 59 testes em quatro arquivos; última rodada de editor/visual: 21 testes aprovados.
- Testes novos com FFmpeg real verificam as cinco posições, escala/opacidade, banner dentro/fora da janela, capa no primeiro quadro, prioridade individual, cache no retry, hash congelado e original intacto.
- Também verificam zero ferramentas/arquivos/receitas/jobs no rascunho, rollback integral das receitas de uma transação inválida, replay sem duplicação e bloqueio de edição após agendamento.
- Electron E2E: Biblioteca/Containers, configuração visual e pipeline JIT aprovados. Conta sintética, data futura e banco/perfil temporários; nenhum provedor de publicação é chamado.

[Configuração no Sheet](screens/qa-containers/configuracao-visual.png). A versão de teste aberta para revisão usa dados isolados, vídeo sintético e nenhuma conta conectada. A instalação e o banco de uso cotidiano não são alterados.
