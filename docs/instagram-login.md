# Login Instagram por navegador — análise de viabilidade

Análise realizada em 6 de outubro de 2026 para o Legacy 0.7.0.

É possível substituir a digitação do token por **Business Login for Instagram**, para contas profissionais Business ou Creator. O usuário autoriza o Legacy no navegador; o token continua existindo nos bastidores. Não se deve pedir a senha do Instagram dentro do aplicativo.

## Fluxo recomendado

1. O Legacy solicita ao servidor uma sessão de conexão curta, vinculada ao workspace e a um identificador aleatório.
2. Abre a autorização oficial do Instagram no navegador, solicitando apenas `instagram_business_basic` e `instagram_business_content_publish`.
3. A Meta retorna um código de autorização e `state` para uma URL HTTPS cadastrada exatamente no painel do app.
4. O servidor valida `state`, expiração e uso único, e troca o código pelo token usando o segredo do app.
5. O servidor troca o token curto por um de longa duração e verifica a identidade profissional (`user_id`).
6. O Electron recupera o resultado por uma sessão autenticada de uso único, vinculada ao dispositivo. Armazena o token protegido pelo Windows, com workspace, conta, permissões e validade. Tokens não devem circular em URLs de retorno, logs ou capturas.
7. O Legacy atualiza a conexão e usa o serviço de publicação existente. A renovação deve acompanhar a expiração e pedir nova autorização quando necessário.

## Pré-requisitos e decisões pendentes

| Item | Situação |
| --- | --- |
| App Meta | Já criado; isso não confirma configuração OAuth completa. |
| Leitura e publicação pelo backend Legacy | Implementadas com token Instagram User; testes locais usam API simulada. |
| Servidor HTTPS para troca de código/token | Não configurado nesta entrega. |
| Redirect URI e configuração Business Login | Precisam ser verificados e cadastrados para o servidor escolhido. |
| Segredo do app | Deve ficar exclusivamente no servidor, fora do Electron, Git e instalador. |
| Acesso público a contas de terceiros | Depende do nível de acesso e aprovação exigidos pela Meta. Standard Access atende contas profissionais administradas e adicionadas ao app; Advanced Access é necessário para as demais. |
| Renovação, revogação e reconexão | Precisam ser implementadas e testadas no fluxo OAuth. |
| Validação real | Requer autorização da conta profissional e teste de ponta a ponta. Login bem-sucedido não garante publicação. |

O código de autorização é de uso único e válido por uma hora. Tokens longos duram 60 dias; a renovação exige token válido, emitido há pelo menos 24 horas. Se expirou, deve haver novo login. Esses valores vêm da documentação consultada e não devem ser usados como substitutos da validade retornada pela API.

## Impacto no código

- Reutilizar o modal **Conectar conta**, seus erros e estados existentes; adicionar login somente quando o servidor estiver pronto.
- Separar início, retorno e finalização da autorização em um serviço no main process; validar todos os canais IPC com Zod.
- Reutilizar a validação de conta e o cofre atual. Reconectar o mesmo destino preserva os agendamentos; trocar conta não redireciona tarefas anteriores.
- Não embutir `client_secret` em variáveis de build, `app.asar`, renderer ou configuração no computador. A documentação da Meta exige a troca de token longo no servidor.
- Testar `state` inválido, sessão expirada, retorno repetido, usuário que negou acesso, conta pessoal, workspace trocado, token expirado e falha de rede. Nunca duplicar uma sessão ou publicação em um retry.

**Conclusão:** tecnicamente viável e recomendado como próximo fluxo de conexão. Esta entrega mantém o método por token e não apresenta um botão de login incompleto como se estivesse funcionando.

Fonte primária: [Business Login for Instagram — documentação Meta](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login), consultada em 2026-10-06; página atualizada em 2026-03-13.
