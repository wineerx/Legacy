# ADR 0001: Electron como shell do app

Data: 2026-10-04. Status: aceita.

## Contexto

O produto é vendido por assinatura para criadores que operam volume de vídeos no próprio PC. Precisa de bandeja, execução em segundo plano, FFmpeg local, fila persistente e dados fora de qualquer servidor ("SaaS local").

## Opções

1. Laravel + Inertia (web hospedada): simples de implantar, mas processa vídeo no servidor, tem custo por cliente e não roda em segundo plano no PC.
2. Node web (servidor local no navegador): sem bandeja nem instalador nativo, experiência frágil.
3. Electron: instalador, bandeja, utilityProcess para o worker, acesso a arquivos e FFmpeg.

## Decisão

Electron, por escolha do usuário e pelo modelo "SaaS local". Stack: electron-vite, React 19, TypeScript, Tailwind v4, SQLite (better-sqlite3 + Drizzle), TanStack Query, Vitest e Playwright. Versões efetivas: Electron 42.11.10 e better-sqlite3 12.11.1. O plano previa 44/13, mas não há binário pré-compilado de better-sqlite3 13 para o ABI do Electron 44, e exigir Build Tools do Visual Studio dos clientes foi descartado.

## Consequências

- Rebuild nativo do SQLite por versão do Electron (`electron-builder install-app-deps`); subir para o Electron 44 quando houver binário.
- Broker (Cloudflare) é obrigatório na fase B para OAuth e para hospedar `video_url` temporário.
- Code signing é custo do operador; sem ele o SmartScreen avisa.
- Instalador grande (Electron mais FFmpeg).
- O agendamento depende do PC ligado e do app na bandeja.
- Licença do FFmpeg: build LGPL fixado; ver a decisão sobre libopenh264 em `docs/progress.md`.
