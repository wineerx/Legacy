# Segurança (fase A)

- Renderer com `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. O preload usa só `contextBridge` e `ipcRenderer`, sem pacotes npm.
- Todo canal IPC tem entrada validada por zod em `src/shared/ipc-contract.ts`; o dispatcher recusa canais desconhecidos e converte `PathEscapeError` em `invalid_input`. Limites no contrato: PNG até 20 MB, caminhos até 1024 caracteres, `remindAt` com o mesmo tamanho de `assetIds`.
- Caminhos de arquivo passam por `resolveInside` (impede escapar da pasta do workspace). `export.openFolder` só abre diretórios dentro de `<workspace>/exports`.
- `library.importPaths` aceita caminhos do renderer (necessário para arrastar e soltar): recusa link simbólico e não-arquivo, e limita a 1 GiB antes do hash. Risco aceito: um renderer comprometido ainda poderia ler vídeos do disco.
- Protocolo `legacy-media` serve somente `<dataRoot>/workspaces`, com CORS habilitado para permitir `canvas.toBlob`.
- FFmpeg e ffprobe: `spawn` com argumentos em array, sem shell, timeout, limites de duração e tamanho; temporários apagados em `finally`. O download do FFmpeg é fixado por versão e conferido por sha256.
- CSP restrita no renderer; `webSecurity` ligado; `setWindowOpenHandler` só abre `instagram.com` externamente.
- Segunda instância sai antes de qualquer inicialização; encerramento do Windows e `will-quit` param o worker com timeout.
- Erros devolvidos ao renderer são genéricos (`AppError` com código e mensagem); detalhes ficam só no log do main.
- A integração de downloads usa `APIFY_TOKEN` exclusivamente no ambiente dos processos main/worker, sem persistir ou devolver a chave por IPC. Payloads internos dos downloads contêm URLs assinadas temporárias de mídia; não são enviados à interface.

## Downloads e armazenamento (2026-10-05)

- HTTPS restrito a api.apify.com para API e subdomínios de cdninstagram.com/fbcdn.net para mídia. DNS IPv4 público validado e fixado à conexão; redirecionamentos de mídia revalidados e limitados a três. Redirects autenticados da API são recusados. Nenhum header de autorização vai ao CDN.
- Limite de 1 GiB por vídeo em streaming, timeout de cinco minutos; respostas JSON limitadas a 10 MiB. ffprobe restrito ao demuxer MOV/MP4 e protocolo de arquivo, recusando playlists disfarçadas. Hash e validação antes de disponibilizar o asset.
- Seleção de armazenamento somente via diálogo nativo, sem caminho arbitrário no contrato IPC. Subdiretório separado por workspace e teste de escrita. Protocol handler aceita pastas internas e diretórios de assets registrados, preservando acesso após troca de destino.
- A pasta personalizada guarda somente novos arquivos. Backup deve incluir os destinos antigos e atuais. Não há mudança automática do banco, exportações ou temporários.

## Pendências

- Fase B: tokens com `safeStorage` (DPAPI), nunca em log nem no renderer; OAuth via broker (ticket de uso único, `client_secret` só no broker); allowlist de hosts da Meta para miniaturas; auditoria.
- Minors adiados (por exemplo `senderFrame` no ipcMain, `will-redirect`, permission handler): ver `docs/progress.md`.
- `npm audit` mostra 4 vulnerabilidades moderate não tratadas.
- Instalador sem assinatura de código.
- Incremento 0.2.0: credenciais cadastradas na interface são protegidas com Electron safeStorage (DPAPI no Windows), armazenadas cifradas por workspace e enviadas ao worker por canal interno de mensagens em memória. A configuração devolvida ao renderer contém somente estado; o campo de entrada é limpo após salvar/fechar. APIFY_TOKEN no ambiente continua como alternativa global, com indicação de origem na UI. Uma credencial cifrada ilegível não faz fallback silencioso para outra conta.
- Webhooks de saída são opt-in e desativados por padrão. Domínio HTTPS público, DNS IPv4 fixado à conexão, sem redirects; assinatura HMAC-SHA256, ID persistente para dedupe, limite de tentativas e Retry-After. Payload sanitizado não inclui chaves, caminhos, legendas ou URLs assinadas. Alterações do destino/segredo/ativação invalidam tarefas antigas. Nenhum listener de entrada foi aberto.
- Tutoriais usam etapas internas fixas, não executam downloads/exportações/publicações automaticamente e respeitam movimento reduzido. Referências são URLs normalizadas do Instagram; métricas e legendas de destaque são consultadas por workspace.
