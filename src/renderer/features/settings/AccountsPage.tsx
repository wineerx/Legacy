import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Input, useToast } from '../../components/ui'

export function AccountsPage() {
  const { workspace } = useWorkspace(); const qc = useQueryClient(); const toast = useToast()
  const [token, setToken] = useState('')
  const account = useQuery({ queryKey: ['instagram-account', workspace.id], queryFn: () => call('accounts.instagram', { workspaceId: workspace.id }) })
  const done = () => { void qc.invalidateQueries(); toast.show({ title: 'Conta atualizada' }) }
  const fail = (e: unknown) => toast.show({ title: 'Não foi possível conectar', body: e instanceof Error ? e.message : undefined, tone: 'error' })
  const connect = useMutation({ mutationFn: (value: string) => call('accounts.connectInstagram', { workspaceId: workspace.id, token: value }), onSuccess: done, onError: fail })
  const disconnect = useMutation({ mutationFn: () => call('accounts.disconnectInstagram', { workspaceId: workspace.id }), onSuccess: done, onError: fail })
  return <div className="mx-auto flex max-w-3xl min-w-0 flex-col gap-5 p-6"><h1 className="text-xl font-semibold">Contas</h1><section className="rounded-card border border-line bg-panel p-5"><h2 className="font-semibold">Instagram profissional · conexão por token</h2><p className="my-3 text-sm text-dim">Use um token Instagram User de um app Meta com Instagram Login, com instagram_business_basic e instagram_business_content_publish. A conta precisa ser profissional (Business ou Creator). O cadastro verifica a identidade; a permissão de publicação será validada pela API ao executar a tarefa.</p><p className="mb-3 text-sm">{account.isLoading ? 'Consultando conta…' : account.data ? `Conectada: @${account.data.username}` : account.isError ? 'Não foi possível consultar a conta.' : 'Nenhuma conta conectada neste workspace.'}</p><form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); connect.mutate(token); setToken('') }}><Input label="Token de acesso Instagram" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /><div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={token.length < 20 || connect.isPending}>Verificar e conectar conta</Button>{account.data && <Button disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Desconectar conta</Button>}</div></form><p className="mt-4 text-xs text-dim">O token fica protegido pelo Windows e não é exibido novamente. Não há login OAuth pelo navegador nesta versão. Ao trocar ou desconectar a conta, agendamentos anteriores não serão enviados para outro destino. TikTok segue com exportação e postagem manual.</p></section></div>
}
