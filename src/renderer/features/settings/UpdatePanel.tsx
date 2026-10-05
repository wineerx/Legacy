import { useMutation, useQuery } from '@tanstack/react-query'
import { call } from '../../lib/api'
import { Button, useToast } from '../../components/ui'

export function UpdatePanel() {
  const toast = useToast()
  const status = useQuery({ queryKey: ['updates'], queryFn: () => call('updates.status', {}), refetchInterval: 1500 })
  const error = (e: unknown) => toast.show({ title: 'Atualização não concluída', body: e instanceof Error ? e.message : undefined, tone: 'error' })
  const check = useMutation({ mutationFn: () => call('updates.check', {}), onSuccess: () => status.refetch(), onError: error })
  const download = useMutation({ mutationFn: () => call('updates.download', {}), onSuccess: () => status.refetch(), onError: error })
  const install = useMutation({ mutationFn: () => call('updates.install', {}), onError: error })
  const s = status.data
  return <section className="rounded-card border border-line bg-panel p-5 text-sm"><h2 className="font-semibold">Atualizações do Legacy</h2><p role="status" className="my-3 text-dim">{s?.message ?? 'Consultando atualizador…'}</p>{s?.state === 'downloading' && <progress className="mb-3 w-full" max={100} value={s.progress} aria-label="Download da atualização" />}<div className="flex flex-wrap gap-2"><Button disabled={!s || ['unsupported', 'checking', 'downloading', 'downloaded'].includes(s.state) || check.isPending} onClick={() => check.mutate()}>Verificar atualizações</Button>{s?.state === 'available' && <Button disabled={download.isPending} onClick={() => download.mutate()}>Baixar versão {s.version}</Button>}{s?.state === 'downloaded' && <Button variant="primary" disabled={install.isPending} onClick={() => install.mutate()}>Instalar e reiniciar</Button>}</div><p className="mt-3 text-xs text-dim">Releases oficiais de wineerx/Legacy. A consulta não baixa nem instala automaticamente. A primeira instalação dessa versão usa o instalador; as próximas podem ser feitas aqui.</p></section>
}
