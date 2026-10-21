# Limite de publicação Instagram por conta

> Atualização PR 05: a janela e o limite agora vêm de `content_publishing_limit`, lido na revisão do Container e logo após uma recusa da Meta. A estimativa de 24 horas abaixo permanece apenas quando não há leitura válida. Detalhes em [PR 05](pr05-quota-scheduler.md).

O HTTP 400 com código 9 e subcódigo 2207042 agora adia a publicação, sem consumir tentativas nem registrar falha definitiva. Outros subcódigos mantêm seu tratamento anterior.

O worker persiste um cooldown `publication_quota` por workspace e conta. Desloca as publicações pendentes desse destino pelo mesmo intervalo, mantendo o espaçamento, os IDs, o payload original e os checkpoints. O horário originalmente solicitado permanece no payload; `run_at` representa a próxima execução. Outras contas, downloads e exportações TikTok permanecem elegíveis. Sucesso em consultas de status não remove esse cooldown.

A estimativa usa a publicação local mais antiga ainda na janela móvel de 24 horas, acrescida de um minuto de margem, e respeita `Retry-After`. Na ausência de histórico, consulta novamente após uma hora. A Meta continua sendo a autoridade: publicações de outros aplicativos podem consumir a cota sem aparecer no histórico local. Uma nova recusa estende a espera.

A Fila mostra “Conta limitada” e a retomada estimada, também nos detalhes. A ordem adiada prevalece sobre prioridade e sobre os horários de polling, evitando que um item posterior ultrapasse o primeiro. Reagendamento manual continua disponível no menu da tarefa.

Contêiner FINISHED é reutilizado. EXPIRED depois de uma recusa explícita permite preparar outro contêiner; publicação ambígua continua protegida. O cache de versões processadas referenciado por publicações pendentes é preservado na limpeza após reinício. Originais e receitas não são alterados. Se o cache estiver corrompido ou ausente, sua validação e reconstrução existentes permanecem necessárias.

Validação: testes do transporte, cálculo da janela, lote de 35 itens, isolamento por conta/workspace, polling, prioridades, repetição de limite, fencing de lease, preservação de cache, retomada do contêiner, worker e interface. Nenhuma publicação real ou alteração da base do aplicativo instalado foi executada durante a implementação. A correção precisa ser distribuída em uma nova versão para atuar no aplicativo instalado; não reativa automaticamente tarefas que já estavam em falha.
