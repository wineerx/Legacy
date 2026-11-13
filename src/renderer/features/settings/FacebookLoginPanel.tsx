import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { call } from '../../lib/api'
import { Button } from '../../components/ui'

type Candidate = { id: string; username: string; pageName: string }

/** Facebook Login through the Legacy broker: needed for music from Meta's catalog. Instagram Login stays as the token option. */
export function FacebookLoginPanel({ workspaceId, onConnected }: { workspaceId: string; onConnected(): void }) {
  const [choice, setChoice] = useState<{ handle: string; accounts: Candidate[] } | null>(null)
  const [error, setError] = useState('')
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Não foi possível concluir o login com Facebook.')
  const finish = useMutation({
    mutationFn: (v: { handle: string; accountId: string }) => call('accounts.connectFacebook', { workspaceId, ...v }),
    onSuccess: () => { setChoice(null); setError(''); onConnected() }, onError: fail
  })
  const login = useMutation({
    mutationFn: () => call('accounts.facebookLogin', { workspaceId }),
    onSuccess: r => { setError(''); if (r.accounts.length === 1) finish.mutate({ handle: r.handle, accountId: r.accounts[0].id }); else setChoice(r) },
    onError: fail
  })
  return <div className="grid gap-3 rounded-ctl border border-line p-3 text-sm">
    <div><strong>Entrar com Facebook · música do catálogo</strong>
      <p className="mt-1 text-xs text-dim">Necessário para anexar músicas da Meta aos Reels. A conta Business ou Creator precisa estar vinculada a uma Página do Facebook.</p>
      <ul className="mt-2 grid gap-1 text-xs text-dim"><li>instagram_basic e instagram_content_publish · identidade e publicação</li><li>pages_show_list e pages_read_engagement · encontrar a Página vinculada</li></ul>
    </div>
    {!choice && <Button variant="primary" loading={login.isPending || finish.isPending} onClick={() => { setError(''); login.mutate() }}>Entrar com Facebook</Button>}
    {login.isPending && <p role="status" className="text-xs text-dim">Conclua o login no navegador. Esta janela atualiza sozinha.</p>}
    {choice && <div className="grid gap-2" role="group" aria-label="Escolha a conta Instagram">
      <p className="text-xs text-dim">Escolha a conta que o Legacy vai usar:</p>
      {choice.accounts.map(a => <Button key={a.id} loading={finish.isPending && finish.variables?.accountId === a.id} onClick={() => finish.mutate({ handle: choice.handle, accountId: a.id })}>@{a.username} · {a.pageName || 'Página sem nome'}</Button>)}
    </div>}
    {error && <p role="alert" className="text-xs text-danger-fg">{error}</p>}
    <p className="text-xs text-dim">O token fica protegido pelo Windows. Reconectar a mesma conta mantém os agendamentos.</p>
  </div>
}
