import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { call, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, SettingRow, Toggle, useToast } from '../../components/ui'
import type { PageProps } from '../../routes'
import { IntegrationPanel } from './IntegrationPanel'
import { UpdatePanel } from './UpdatePanel'

type Key = 'minimizeToTray' | 'stripMetadataDefault'

function useBoolSetting(workspaceId: string, key: Key) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['setting', workspaceId, key], queryFn: () => call('settings.get', { workspaceId, key }) })
  const m = useMutation({ mutationFn: (v: boolean) => call('settings.set', { workspaceId, key, value: v ? 'true' : 'false' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['setting', workspaceId, key] }) })
  return { value: q.data !== 'false', set: (v: boolean) => m.mutate(v) }
}

export function SettingsPage(_: PageProps) {
  const { workspace, dataDir } = useWorkspace()
  const tray = useBoolSetting(workspace.id, 'minimizeToTray')
  const strip = useBoolSetting(workspace.id, 'stripMetadataDefault')
  const qc = useQueryClient()
  const toast = useToast()
  const storage = useQuery({ queryKey: ['storage', workspace.id], queryFn: () => call('storage.get', { workspaceId: workspace.id }) })
  const changeStorage = useMutation({
    mutationFn: (reset: boolean) => reset ? call('storage.reset', { workspaceId: workspace.id }) : call('storage.choose', { workspaceId: workspace.id }),
    onSuccess: (value) => { if (value) { void qc.invalidateQueries({ queryKey: ['storage', workspace.id] }); toast.show({ title: 'Pasta dos vídeos atualizada' }) } },
    onError: (e) => toast.show({ title: 'Não foi possível alterar a pasta', body: e instanceof ApiError ? e.message : 'Verifique o acesso à pasta.', tone: 'error' })
  })
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header><h1 className="text-xl font-semibold">Geral</h1><p className="text-sm text-dim">Comportamento do app e padrões do workspace {workspace.name}.</p></header>
      <section className="rounded-card border border-line bg-panel px-6">
        <SettingRow title="Manter na bandeja ao fechar" description="Fechar a janela deixa o Legacy rodando na bandeja para a fila e os lembretes continuarem." control={<Toggle label="Manter na bandeja ao fechar" checked={tray.value} onChange={tray.set} />} />
        <div className="border-t border-line" />
        <SettingRow title="Remover metadados opcionais por padrão" description="Localização, dispositivo e título embutidos saem dos vídeos exportados. Dá para mudar em cada lote." control={<Toggle label="Remover metadados opcionais por padrão" checked={strip.value} onChange={strip.set} />} />
      </section>
      <section data-tour="storage" className="rounded-card border border-line bg-panel p-6 text-sm">
        <h2 className="font-semibold">Armazenamento dos vídeos</h2>
        <p className="mt-2 break-all text-dim">{storage.data?.path ?? (storage.isError ? 'Não foi possível consultar a pasta.' : 'Carregando…')}</p>
        <p className="mt-2 text-dim">Novos downloads e importações serão guardados nesta pasta, separada por workspace. A troca não move os vídeos existentes: eles continuam acessíveis no local original.</p>
        <div className="mt-3 flex gap-2">
          <Button disabled={changeStorage.isPending} onClick={() => changeStorage.mutate(false)}>Alterar pasta dos vídeos</Button>
          <Button disabled={changeStorage.isPending || !storage.data?.custom} onClick={() => changeStorage.mutate(true)}>Restaurar pasta padrão</Button>
        </div>
      </section>
      <section className="rounded-card border border-line bg-panel p-6 text-sm">
        <h2 className="font-semibold">Sobre esta versão</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-dim">
          <li>Versão: {window.legacy.version}.</li>
          <li>Atualizações pelas releases oficiais no GitHub.</li>
          <li>Pasta de dados: {dataDir}</li>
          <li>Fuso do workspace: {workspace.timeZone}.</li>
          <li>Vídeos, capas e exportações ficam só neste computador.</li>
          <li>Tarefas e lembretes rodam com o PC ligado e o Legacy aberto. Desligado ou em suspensão, nada é processado.</li>
          <li>Instagram: agendamento por token de conta profissional em Contas. TikTok: postagem manual a partir da pasta exportada.</li>
        </ul>
      </section>
      <IntegrationPanel />
      <UpdatePanel />
    </div>
  )
}
