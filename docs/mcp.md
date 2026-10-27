# MCP do Legacy — 2026-10-26

Permite que o Claude, no mesmo computador, programe um vídeo ou um lote inteiro: legenda por vídeo, Reels de teste e faixa de áudio.

## Peças

```
Claude ──stdio──► mcp/legacy-mcp.ts ──HTTP 127.0.0.1 + token──► src/main/ipc/mcp-bridge.ts ──► dispatcher (zod, workspace) ──► serviços
```

- **Bridge** (`src/main/ipc/mcp-bridge.ts`): sobe com o app em uma porta aleatória de loopback e grava `{ port, token }` em `<dados>/mcp-bridge.json` (removido ao fechar). Recusa requisição com `Origin`, `Host` diferente de `127.0.0.1:<porta>` ou token errado. Só canais de `MCP_BRIDGE_CHANNELS` passam; credenciais, exclusão, armazenamento e configurações ficam só na janela. Mantém o mesmo gate da sessão de visitante. `LEGACY_MCP_BRIDGE=0` desliga.
- **Servidor MCP** (`mcp/legacy-mcp.ts`): roda com `node mcp/legacy-mcp.ts` (Node 24 remove os tipos). Não abre o SQLite nem vê segredos. Registrado no `.mcp.json` do projeto. O SDK é devDependency: funciona a partir do checkout, não do instalador.

## Tools

| Tool | Canal |
|---|---|
| `legacy_status`, `legacy_listar_contas` | `app.bootstrap`, `session.get`, `jobs.health`, `accounts.instagramList` |
| `legacy_listar_videos`, `legacy_importar_videos` | `grid.query`, `library.importPaths` |
| `legacy_importar_audio`, `legacy_listar_audios` | `audio.importPath`, `audio.list` |
| `legacy_criar_lote` | `containers.create` (rascunho) + `quota.get` + `publications.checkRepost` |
| `legacy_agendar_lote` | `containers.schedule`: cria as publicações reais, só depois de um sim da pessoa |
| `legacy_ver_lote`, `legacy_listar_lotes` | `containers.get`, `containers.query` |
| `legacy_pausar_lote`, `legacy_retomar_lote`, `legacy_cancelar_lote` | `containers.pause/resume/cancel` |
| `legacy_status_fila` | `jobs.query` |

Legenda por vídeo usa `captionOverride` do item; Reels de teste usa `trialGraduation` (`MANUAL` ou `SS_PERFORMANCE`).

## Faixa de áudio

- `audio.importPath` copia MP3/M4A/AAC/WAV (até 200 MB) para `workspaces/<id>/audio/<sha256>.<ext>`, com um `.json` de metadados. O arquivo escolhido não é alterado; os mesmos bytes reaproveitam a mesma faixa.
- O snapshot do Container ganhou a camada opcional `audio` (`replace` ou `mix`, volumes em %, `startMs`). Ela entra no hash selado da receita como as camadas visuais; snapshots antigos continuam válidos.
- Agendar confere se a faixa existe. Na publicação, `materializeVersion` confere o SHA-256 da faixa e aplica `applyAudioTrack` depois das camadas visuais, sem recodificar a imagem. Faixa curta recebe silêncio no fim; faixa longa é cortada na duração do vídeo.
- A tela do Container ainda não edita a camada de áudio; por enquanto ela é definida pelo MCP.
