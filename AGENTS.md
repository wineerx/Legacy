# Legacy: guia para agentes

## Mapa de pastas

```
src/shared/    tipos, formatação, URL do Instagram, agenda, contrato IPC (zod), erros
src/main/      ciclo de vida (index.ts), paths, supervisor do worker, tray, media-protocol, reminders
  db/          schema (Drizzle), client, migrations
  repos/       acesso a dados; todo filtro leva workspace_id
  queue/       fila de jobs com lease
  media/       ffmpeg-bin, run, probe, validate, ops, encoders
  services/    library, metrics-import, csv, grid, export-tiktok, onboarding, versions
  worker/      worker.ts, handlers.ts (utilityProcess)
  ipc/         dispatcher.ts, handlers.ts
src/preload/   ponte contextBridge (sem pacotes npm)
src/renderer/  React: routes, components/ui, features/*, lib/*
tests/e2e/     Playwright para Electron
docs/          arquitetura, design system, segurança, plataformas, decisões, roadmap, progresso
```

## Regras globais (Global Constraints do plano)

- Plataforma alvo: Windows 11 x64; Node do sistema 24; Electron 42.11.10 e better-sqlite3 12.11.1 (decisão do controlador; o plano dizia 44/13, sem binário pré-compilado).
- Versões fixadas: `vite@^7`, `@vitejs/plugin-react@5.2.0`, `typescript@5.9.3` (não usar TS 7), `vitest@5.0.3`.
- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Toda entrada IPC validada com zod.
- Casos de uso em `src/main/**` (exceto `index.ts`, `ipc/`, `tray.ts`, `supervisor.ts`) não importam `electron`.
- Toda tabela de domínio tem `workspace_id`; toda consulta de repositório filtra por ele.
- Datas persistidas em UTC ISO-8601; fuso IANA por workspace.
- Métrica ausente = `null`, exibida como "—" com tooltip "Indisponível". Nunca zero.
- FFmpeg chamado com argumentos em array (`spawn`, sem shell); caminhos resolvidos com `resolveInside`; original nunca alterado.
- FFmpeg build LGPL apenas. Proibido `ffmpeg-static` (GPL).
- Downloads de reels públicos de terceiros autorizados pelo pedido de 2026-10-05: integração Apify no worker, origem `ig_third_party`, procedência preservada e download HTTPS restrito. Links manuais continuam referências sem download automático.
- UI em pt-BR, sentence case, sem "por favor", "com sucesso" ou exclamação em texto de sistema.
- Tokens visuais: veja `docs/design-system.md` (ajustados em contraste na Task 15).
- Commits terminam com `Co-Authored-By: Codex Opus 5.5 <noreply@anthropic.com>`.

## Testes

`npm test` roda o Vitest dentro do Electron (`ELECTRON_RUN_AS_NODE=1 electron vitest run`) para que better-sqlite3 use o ABI do Electron. Não rode `vitest` com o Node do sistema. `npm run typecheck` antes de commitar. `npm run e2e` compila e abre o app real.

## Onde está cada coisa

- Spec: `docs/superpowers/specs/2026-10-04-legacy-fase-ab-design.md`
- Plano: `docs/superpowers/plans/2026-10-04-legacy-fase-a.md`
- Decisões: `docs/decisions/`
- Progresso, rulings e pendências: `docs/progress.md`
