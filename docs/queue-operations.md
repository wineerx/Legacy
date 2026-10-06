# Fila: acompanhamento e recuperação

## Usar a fila

- O resumo mostra contagens completas para os filtros de busca, tipo e lote. Clicar em um estado aplica esse filtro.
- Busque por nome da tarefa, ID ou conta de destino. `%` e `_` são tratados como texto.
- Escolha 10, 25, 50 ou 100 tarefas por página. A consulta é feita no SQLite; a nova tela não depende da lista antiga limitada a 500 itens.
- Alterne **Lista de tarefas** e **Árvore de lotes**. A árvore agrupa apenas relações reais existentes (`batchId`, por exemplo downloads gerados por uma busca). Ela mostra os itens da página atual; **Ver lote completo** remove os outros filtros e consulta todas as páginas daquele lote.
- Abra **Andamento e tentativas** para ver início, término, duração, resultado e erro das últimas 50 tentativas. O total histórico também aparece; reiniciar tentativas não apaga esse histórico.
- **Ver tarefa** mantém o player interno, arquivos, origem e pastas exportadas. Nenhum payload bruto, token ou segredo é enviado ao renderer.

## Quando uma publicação falhar

**Cancelar:** cancela uma tarefa aguardando ou falhada e conserva o histórico. Não interrompe uma execução já iniciada nem remove conteúdo já aceito pelo Instagram.

**Passar a vez:** sugere um horário 15 minutos após a última tarefa pendente do mesmo tipo e destino no workspace. Para Instagram, considera apenas a mesma conta. Revise a data e o fuso no seletor existente; é possível escolher outro horário. Confirme para realocar a mesma tarefa. Os horários das outras tarefas não mudam. Uma falha já permite que o worker execute as próximas; não é necessário realocar para destravar a fila.

**Tentar de novo:** reutiliza a tarefa e os checkpoints existentes. Se houve resposta incerta da plataforma, confira a conta antes. O Legacy não apaga o registro remoto para forçar um novo envio.

O backend rejeita mudança para o passado, mais de 90 dias no futuro, tarefa em execução, workspace alheio e revisão desatualizada. Na realocação de uma falha, o orçamento de tentativas é reiniciado e o histórico permanece.

## Referência de interface

Foi estudado o preview público de [Data Source Status](https://www.shadcn-ui-blocks.com/blocks/application-pro/onboarding/data-source-status), da categoria [Onboarding](https://www.shadcn-ui-blocks.com/blocks/application-pro/onboarding): linhas organizadas, estado ao lado da tarefa, erro contextual e ação de recuperação. O código premium não foi utilizado. A adaptação reutiliza `Button`, `Select`, `SearchInput`, `Badge`, `Spinner`, `Modal`, `DeliveryTime`, tokens atuais e o padrão de detalhes recolhíveis já usado no Legacy.

Não há percentuais simulados nem novas dependências de interface. A estrutura pode expandir para outros tipos de tarefa sem duplicar componentes do Design System.
