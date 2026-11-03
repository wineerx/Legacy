# Broker do Legacy · Facebook Login

Cloudflare Worker que guarda o segredo do app Meta e faz o OAuth do Facebook Login. O Legacy (Electron) nunca recebe o `client_secret`.

## Fluxo

1. O Legacy abre uma porta local em `127.0.0.1` e chama `POST /v1/facebook/sessions` com essa porta. Recebe `sessionId`, `pollToken` e a URL de autorização.
2. O navegador abre `www.facebook.com/v25.0/dialog/oauth` com `instagram_basic`, `instagram_content_publish`, `pages_show_list` e `pages_read_engagement`.
3. A Meta chama `GET /v1/facebook/callback`. O broker valida o `state` (uso único), troca o código por token curto e depois por token longo (cerca de 60 dias) e lê as permissões concedidas. O token fica cifrado (AES-GCM) no KV por até 5 minutos.
4. O navegador é redirecionado para `http://127.0.0.1:<porta>/facebook/callback` com uma prova de uso único. Nenhum token circula em URL.
5. O Legacy resgata o token em `POST /v1/facebook/sessions/{id}/token` com `pollToken` + prova. O resgate funciona uma única vez.

Quem só tem o link de autorização não consegue o token: a prova chega à máquina de quem autorizou.

## Publicar o Worker

```bash
cd broker
npx wrangler kv namespace create SESSIONS     # copie o id para wrangler.toml
npx wrangler secret put FB_APP_SECRET         # App Secret do painel Meta
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put SESSION_KEY
npx wrangler deploy
```

Em `wrangler.toml`, preencha `FB_APP_ID` e `PUBLIC_ORIGIN` (a URL HTTPS do Worker publicado).

## Apontar o Legacy para o broker

O endereço entra no build:

```bash
LEGACY_BROKER_URL=https://legacy-broker.<sua-conta>.workers.dev npm run build
```

Sem essa variável, o botão Entrar com Facebook explica que o broker não foi configurado. O Instagram Login por token continua funcionando.

## Painel da Meta

1. **App do tipo Business** em developers.facebook.com, com o produto **Facebook Login for Business** (ou Facebook Login) e **Instagram Graph API** (API com Facebook Login).
2. **Facebook Login › Configurações:** adicione em *URIs de redirecionamento OAuth válidos* exatamente `PUBLIC_ORIGIN/v1/facebook/callback`. Ative *Login OAuth do cliente* e *Login OAuth da Web*, e deixe *Aplicar HTTPS* ativo.
3. **Permissões:** `instagram_basic`, `instagram_content_publish`, `pages_show_list` e `pages_read_engagement`. Em Standard Access, elas valem para quem tem função no app (administrador, desenvolvedor ou testador). Para outras contas, envie o App Review com Advanced Access.
4. **Conta Instagram** Business ou Creator **vinculada a uma Página do Facebook**: no Instagram, em Configurações › Conta › Compartilhamento com outros apps, ou nas configurações da Página › Contas vinculadas. Quem faz o login precisa administrar essa Página e selecioná-la na tela da Meta.
5. **Modo Live:** em *Configurações básicas*, preencha a URL da política de privacidade e a categoria, e mude o app para **Live**. No modo de desenvolvimento, só contas com função no app conseguem autorizar.
6. Se a Página pertencer a um portfólio empresarial e não aparecer na lista, confira se ela foi marcada na tela de login. Algumas configurações exigem também `business_management`. Esse escopo não é pedido nesta versão.

## Testes

`npm test` na raiz roda `broker/src/*.test.ts` com KV e Meta simulados. Os testes não fazem nenhuma chamada real.

## Limitações

- O KV do Cloudflare tem consistência eventual. O uso único depende dos hashes de `pollToken` e da prova, e um resgate repetido em paralelo, na mesma janela de segundos, não é bloqueado de forma atômica. Para garantia estrita, migre para Durable Objects.
- Sem rate limiting próprio: configure uma regra de WAF/Rate Limiting no Cloudflare para `/v1/facebook/sessions`.
- O token longo não é renovado automaticamente. Quando expirar, a publicação falha com o código 190 e pede novo login.
