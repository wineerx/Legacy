# PR 04 — plano de implementação

Spec: ../specs/2026-10-09-pr04-visual-template-builder.md. Execução direta aprovada pelo usuário, sem reconfirmações.

- [x] 1. Contratos de cena/snapshot v2 e Templates; testes RED, migration, repository/service/IPC; GREEN.
- [x] 2. Renderer Canvas compartilhado, texto/variáveis/fit/clip; adapter Electron isolado e bridge worker; testes RED/GREEN.
- [x] 3. Composição FFmpeg JIT, contexto congelado e overrides; testes reais/caches/rollback.
- [x] 4. Área Templates, histórico/editor/drag/resize/números/grade/mídia; testes e E2E.
- [x] 5. Aplicação atômica no Container e editor compartilhado, conflitos/versões/arquivo.
- [x] 6. Typecheck, suíte completa, build, Electron E2E Builder/Container/JIT, revisão e documentação.

Restrições: originals intactos; sem publicação externa; sem PR 05. Snapshot independente de Template. Fontes empacotadas, imagem PNG limitada, entrada Zod e consultas scoped por workspace.

Concluído em 2026-10-09: [entrega e validação](../pr04-visual-templates.md).

Ruling: manter o checkout compartilhado que contém as entregas PR 01–03 ainda não commitadas; não criar checkout sem essas alterações nem incluir trabalho anterior em commits automáticos.
