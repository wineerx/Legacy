# ADR 0005: Mochi como avatar do Legacy

Data: 2026-10-21. Status: aceita.

## Contexto

O usuário pediu que o avatar do Legacy seguisse exatamente o Mochi, personagem do Coucou (https://github.com/Louis-CFM/coucou). O código do Coucou é MIT, mas o `LICENSE-ASSETS.md` reserva ao autor, Louis Raillé, o nome, o personagem Mochi (desenho, aparência, expressões e animações), o ícone e os sons. Usar o personagem em outro produto exige permissão por escrito.

## Decisão

O usuário informou em 2026-10-21 que Louis Raillé autorizou por e-mail o uso do Mochi no Legacy. Com isso, o avatar passa a ser o motor de desenho do Mochi portado de `windows/src/mochi/engine.ts` para `src/renderer/components/brand/mochi/engine.ts`, com as mesmas constantes, cores, olhos, estados, emotes, badges e partículas.

Não foram portados: roupas do Coucou, sons, mini bots e a transformação em caixa de correio. Os visuais do Legacy (óculos, gorro, coroa, festa, laço) continuam como camada SVG por cima do corpo. Os estados próprios do Legacy (publicando, baixando, enviando, na espera, atenção, sem rede, novo aviso) usam as cores e os olhos do Mochi.

## Consequências

- Guardar o e-mail de autorização fora do repositório; ele é a base legal desta decisão.
- O nome "Coucou" e o nome "Mochi" não aparecem na interface do Legacy.
- Se a autorização for revogada, voltar ao avatar anterior (commit `e6c1d92`).
