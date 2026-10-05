import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { IntegrationStatus } from '@shared/types'
import { ApiError, call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Input, Modal, SettingRow, Toggle, useToast } from '../../components/ui'

const date = (v: string | null, timeZone: string) => v ? new Date(v).toLocaleString('pt-BR', { timeZone }) : 'Ainda não testada'

export function IntegrationPanel() {
  const { workspace } = useWorkspace()
  return <WorkspaceIntegrations key={workspace.id} />
}

function WorkspaceIntegrations() {
  const { workspace } = useWorkspace()
  const ws = { workspaceId: workspace.id }
  const qc = useQueryClient()
  const toast = useToast()
  const [modal, setModal] = useState<'apify' | 'webhook' | 'notifications' | null>(null)
  const [token, setToken] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [hook, setHook] = useState({ enabled: false, url: '', events: ['job.done', 'job.failed'] as ('job.done' | 'job.failed')[] })
  const [prefs, setPrefs] = useState({ desktop: true, completed: true, failures: true })
  const status = useQuery({ queryKey: ['integrations', workspace.id], queryFn: () => call('integrations.get', ws) })
  const history = useQuery({ queryKey: ['webhooks', workspace.id], queryFn: () => call('webhooks.list', ws), enabled: modal === 'webhook', refetchInterval: modal === 'webhook' ? 5000 : false })
  const action = useMutation({
    mutationFn: async (type: 'saveApify' | 'removeApify' | 'testApify' | 'saveWebhook' | 'testWebhook' | 'saveNotifications' | 'testNotifications') => {
      setError('')
      if (type === 'saveApify') await call('integrations.saveApify', { ...ws, token })
      if (type === 'removeApify') await call('integrations.removeApify', ws)
      if (type === 'testApify') await call('integrations.testApify', ws)
      if (type === 'saveWebhook') await call('webhooks.save', { ...ws, ...hook, ...(secret ? { secret } : {}) })
      if (type === 'testWebhook') await call('webhooks.test', ws)
      if (type === 'saveNotifications') await call('notifications.preferences', { ...ws, ...prefs })
      if (type === 'testNotifications') await call('notifications.test', ws)
      return type
    },
    onSuccess: (type) => {
      setToken(''); setSecret(''); void qc.invalidateQueries()
      const title = type === 'testApify' ? 'Credencial Apify validada' : type === 'testWebhook' ? 'Evento de teste na fila' : type === 'testNotifications' ? 'Notificação de teste criada' : 'Configuração salva'
      toast.show({ title })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível salvar. Tente novamente.')
  })
  const open = (next: typeof modal, s: IntegrationStatus) => { setError(''); setToken(''); setSecret(''); setHook({ enabled: s.webhook.enabled, url: s.webhook.url, events: [...s.webhook.events] }); setPrefs(s.notifications); setModal(next) }
  const close = () => { setModal(null); setToken(''); setSecret(''); setError('') }
  const s = status.data
  const hookDirty = s && (hook.enabled !== s.webhook.enabled || hook.url !== s.webhook.url || JSON.stringify(hook.events) !== JSON.stringify(s.webhook.events) || Boolean(secret))
  return <section data-tour="integrations" className="rounded-card border border-line bg-panel p-5">
    <h2 className="font-semibold">APIs, notificações e webhooks</h2>
    <p className="mt-1 text-xs text-dim">Configure os recursos disponíveis e acompanhe as dependências pendentes.</p>
    {status.isLoading && <p role="status" className="mt-4 text-sm text-dim">Consultando configurações…</p>}
    {status.isError && <div className="mt-4"><p role="alert">Não foi possível carregar as integrações.</p><Button onClick={() => void status.refetch()}>Tentar novamente</Button></div>}
    {s && <div className="mt-4 divide-y divide-line">
      <SettingRow title="Apify · download de reels" description={s.apify.configured ? `Chave ${s.apify.source === 'environment' ? 'do ambiente' : 'salva'}. Última validação: ${date(s.apify.lastValidatedAt, workspace.timeZone)}.` : 'Pendente: cadastre sua chave para buscar vídeos de perfis públicos.'} control={<Button size="sm" onClick={() => open('apify', s)}>Configurar Apify</Button>} />
      <SettingRow title="Notificações" description={`Alertas do Windows ${s.notifications.desktop ? 'ativados' : 'desativados'}. A central interna mantém tarefas e lembretes.`} control={<Button size="sm" onClick={() => open('notifications', s)}>Configurar alertas</Button>} />
      <SettingRow title="Webhooks de saída" description={s.webhook.enabled ? 'Ativados para os eventos selecionados. Consulte entregas e tentativas.' : 'Desativados. Configure um destino HTTPS quando precisar integrar outro sistema.'} control={<Button size="sm" onClick={() => open('webhook', s)}>Configurar webhooks</Button>} />
      <SettingRow title="Instagram · conexão e publicação oficiais" description="Pendente de implementação OAuth, aplicativo Meta e aprovações. A chave Apify não habilita publicação." control={<span className="text-xs text-mute">Indisponível nesta versão</span>} />
      <SettingRow title="TikTok · publicação por API" description="Pendente de integração e elegibilidade do aplicativo. A exportação manual continua disponível." control={<span className="text-xs text-mute">Exportação manual</span>} />
    </div>}
    <Modal open={modal === 'apify'} onOpenChange={(v) => { if (!v) close() }} title="Configurar Apify" description="Sua chave é protegida pelo Windows e não volta a ser exibida. O uso do serviço depende do saldo da sua conta."
      footer={<><Button onClick={close}>Fechar</Button><Button variant="primary" disabled={action.isPending || !token.trim() || !s?.secureStorage} onClick={() => action.mutate('saveApify')}>Salvar chave</Button></>}>
      <Input label="Chave da API Apify" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={s?.apify.configured ? 'Cole uma nova chave para substituir' : 'apify_api_…'} />
      {!s?.secureStorage && <p className="mt-2 text-sm text-warn">Proteção de credenciais indisponível. Não é possível salvar a chave.</p>}
      <p className="mt-3 text-xs text-dim">O teste consulta sua conta e não inicia uma busca paga. {s?.apify.source === 'environment' && 'APIFY_TOKEN do ambiente está ativo; remova a variável e reinicie para desativá-lo.'}</p>
      <div className="mt-3 flex gap-2"><Button disabled={action.isPending || !s?.apify.configured || Boolean(token)} onClick={() => action.mutate('testApify')}>Testar chave salva</Button><Button disabled={action.isPending || s?.apify.source !== 'saved'} onClick={() => action.mutate('removeApify')}>Remover chave salva</Button></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
    </Modal>
    <Modal open={modal === 'webhook'} onOpenChange={(v) => { if (!v) close() }} title="Webhooks de saída" description="Envie eventos da fila para seu sistema. O envio começa somente depois de salvar com a opção ativada."
      footer={<><Button onClick={close}>Fechar</Button><Button variant="primary" disabled={action.isPending || !hook.events.length} onClick={() => action.mutate('saveWebhook')}>Salvar webhook</Button></>}>
      <div className="flex flex-col gap-3">
        <SettingRow title="Ativar envios" description="Desligar impede novas entregas. Requisições já enviadas não podem ser retiradas." control={<Toggle label="Ativar envios de webhook" checked={hook.enabled} onChange={(enabled) => setHook({ ...hook, enabled })} />} />
        <Input label="URL HTTPS do webhook" placeholder="https://seu-sistema.com/webhook/legacy" value={hook.url} onChange={(e) => setHook({ ...hook, url: e.target.value })} />
        <Input label="Segredo de assinatura" type="password" autoComplete="off" placeholder={s?.webhook.hasSecret ? 'Salvo · deixe vazio para manter' : 'Mínimo de 32 caracteres'} value={secret} onChange={(e) => setSecret(e.target.value)} />
        <p className="text-xs text-dim">Use o mesmo segredo no receptor. Assinatura HMAC-SHA256 nos cabeçalhos X-Legacy-Signature e X-Legacy-Timestamp. Não são enviados vídeos, legendas, chaves ou caminhos locais.</p>
        <fieldset className="flex gap-4 text-sm"><legend className="mb-2 text-xs text-dim">Eventos</legend>{(['job.done', 'job.failed'] as const).map((event) => <label key={event} className="flex items-center gap-2"><input type="checkbox" checked={hook.events.includes(event)} onChange={(e) => setHook({ ...hook, events: e.target.checked ? [...hook.events, event] : hook.events.filter((x) => x !== event) })} />{event === 'job.done' ? 'Tarefa concluída' : 'Tarefa falhou'}</label>)}</fieldset>
        <Button disabled={action.isPending || !s?.webhook.enabled || Boolean(hookDirty)} onClick={() => action.mutate('testWebhook')}>Enviar evento de teste</Button>
        {hookDirty && <p className="text-xs text-dim">Salve as alterações antes de testar.</p>}
        {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
        <h3 className="mt-2 text-sm font-semibold">Últimas 20 entregas</h3>
        {history.isError ? <p className="text-sm text-danger-fg">Não foi possível carregar as entregas.</p> : !history.data?.length ? <p className="text-xs text-dim">Nenhuma entrega registrada.</p> : <ul className="space-y-2 text-xs">{history.data.map((d) => <li key={d.id} className="rounded border border-line p-2"><p>{deliveryLabel(d.state, d.result)} · {d.attempts} tentativa(s) · {date(d.updatedAt, workspace.timeZone)}</p>{d.lastError && <p className="mt-1 text-danger-fg">{d.lastError}</p>}</li>)}</ul>}
      </div>
    </Modal>
    <Modal open={modal === 'notifications'} onOpenChange={(v) => { if (!v) close() }} title="Configurar notificações" description="Escolha quais eventos geram avisos. Lembretes de postagem continuam na central interna."
      footer={<><Button onClick={close}>Fechar</Button><Button variant="primary" disabled={action.isPending} onClick={() => action.mutate('saveNotifications')}>Salvar alertas</Button></>}>
      <SettingRow title="Alertas do Windows" description="Dependem das permissões e do modo Não perturbe do Windows." control={<Toggle label="Alertas do Windows" checked={prefs.desktop} onChange={(desktop) => setPrefs({ ...prefs, desktop })} />} />
      <SettingRow title="Conclusões de tarefas" description="Busca de perfis, downloads, banners e exportações." control={<Toggle label="Conclusões de tarefas" checked={prefs.completed} onChange={(completed) => setPrefs({ ...prefs, completed })} />} />
      <SettingRow title="Falhas de tarefas" description="Avisos quando a tarefa esgota as tentativas ou precisa de correção." control={<Toggle label="Falhas de tarefas" checked={prefs.failures} onChange={(failures) => setPrefs({ ...prefs, failures })} />} />
      <Button disabled={action.isPending} onClick={() => action.mutate('testNotifications')}>Criar notificação de teste</Button>
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
    </Modal>
  </section>
}

function deliveryLabel(state: string, result: string | null): string {
  if (state === 'done') { try { return JSON.parse(result ?? '{}').skipped ? 'Ignorada: configuração mudou' : 'Entregue' } catch { return 'Concluída' } }
  return ({ queued: 'Na fila', running: 'Enviando', failed: 'Falhou', cancelled: 'Cancelada' } as Record<string, string>)[state] ?? state
}
