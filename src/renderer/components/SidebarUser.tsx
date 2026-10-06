import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { UserRound, ChevronsUpDown, Settings, LogOut } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '../lib/workspace'
import { useSession } from '../lib/session'
import { UserAvatar } from './ui/UserAvatar'
import { call } from '../lib/api'
import type { PageKey } from '../routes'
import { Button, Modal, Input, Select, Tooltip, useToast } from './ui'

function readProfile() {
  try {
    const data = JSON.parse(localStorage.getItem('legacy.userProfile') ?? '{}')
    return {
      name: typeof data?.name === 'string' ? data.name : '',
      photo: typeof data?.photo === 'string' ? data.photo : ''
    }
  } catch {
    return { name: '', photo: '' }
  }
}

export function SidebarUser({
  collapsed,
  current,
  navigate
}: {
  collapsed: boolean
  current?: PageKey
  navigate(p: PageKey): void
}) {
  const { exit } = useSession()
  const { workspace, workspaces, setWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const toast = useToast()
  const [profile, setProfile] = useState(readProfile)
  const [draft, setDraft] = useState(profile)
  const [edit, setEdit] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [error, setError] = useState('')
  const account = useQuery({
    queryKey: ['instagram-account', workspace.id],
    queryFn: () => call('accounts.instagram', { workspaceId: workspace.id })
  })
  const disconnect = useMutation({
    mutationFn: () =>
      call('accounts.disconnectInstagram', { workspaceId: workspace.id }),
    onSuccess: () => {
      void qc.invalidateQueries()
      setDisconnectOpen(false)
    },
    onError: (e) =>
      setError(
        e instanceof Error ? e.message : 'Não foi possível desconectar a conta.'
      )
  })
  const name =
    profile.name || (account.data ? `@${account.data.username}` : 'Visitante')
  const choosePhoto = async (file?: File) => {
    if (!file) return
    try {
      if (
        file.size > 2 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
      )
        throw Error('Use PNG, JPEG ou WebP de até 2 MB.')
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const side = Math.min(bitmap.width, bitmap.height)
      canvas
        .getContext('2d')!
        .drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          128,
          128
        )
      bitmap.close()
      setDraft((previous) => ({
        ...previous,
        photo: canvas.toDataURL('image/png')
      }))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Imagem inválida.')
    }
  }
  const save = () => {
    try {
      // Preserve older local profile preferences; the guest identity is separate.
      const previous = JSON.parse(
        localStorage.getItem('legacy.userProfile') ?? '{}'
      )
      localStorage.setItem(
        'legacy.userProfile',
        JSON.stringify({ ...previous, ...draft })
      )
      setProfile(draft)
      setEdit(false)
    } catch {
      setError('Não foi possível salvar o perfil.')
    }
  }
  const trigger = (
    <Popover.Trigger
      className="flex w-full items-center gap-2 rounded-ctl p-2 text-left hover:bg-raised"
      aria-label="Menu do usuário"
    >
      <UserAvatar key={profile.photo} name={name} photo={profile.photo} />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-xs">{name}</strong>
            <span className="block truncate text-[11px] text-dim">
              guest@legacy.com
            </span>
          </span>
          <ChevronsUpDown size={14} />
        </>
      )}
    </Popover.Trigger>
  )
  return (
    <>
      <Popover.Root>
        {collapsed ? <Tooltip content={name}>{trigger}</Tooltip> : trigger}
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="end"
            sideOffset={8}
            className="ds-dropdown"
          >
            <div className="border-b border-line p-2">
              <strong className="text-sm">{name}</strong>
              <p className="text-xs text-dim">guest@legacy.com</p>
            </div>
            <Popover.Close asChild>
              <button
                className="flex w-full gap-2 rounded-ctl p-2 text-sm hover:bg-raised"
                onClick={() => {
                  setDraft(profile)
                  setError('')
                  setEdit(true)
                }}
              >
                <UserRound size={16} />
                Editar perfil local
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button
                aria-current={current === 'settings' ? 'page' : undefined}
                className="flex w-full gap-2 rounded-ctl p-2 text-sm hover:bg-raised aria-[current=page]:bg-raised"
                onClick={() => navigate('settings')}
              >
                <Settings size={16} />
                Configurações
              </button>
            </Popover.Close>
            <div className="border-y border-line p-2">
              <Select
                label="Workspace"
                value={workspace.id}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
            <Popover.Close asChild>
              <button
                disabled={!account.data}
                className="flex w-full gap-2 rounded-ctl p-2 text-sm hover:bg-raised disabled:opacity-50"
                onClick={() => {
                  setError('')
                  setDisconnectOpen(true)
                }}
              >
                <LogOut size={16} />
                Desconectar Instagram
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button
                className="flex w-full gap-2 rounded-ctl border-t border-line p-2 text-sm hover:bg-raised"
                onClick={() =>
                  void exit().catch((e) =>
                    toast.show({
                      title: 'Não foi possível sair do Legacy',
                      body: e.message,
                      tone: 'error'
                    })
                  )
                }
              >
                <LogOut size={16} />
                Sair do Legacy
              </button>
            </Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Modal
        open={edit}
        onOpenChange={setEdit}
        title="Perfil local"
        description="Identificação neste computador; não altera o perfil do Instagram."
        footer={
          <>
            <Button onClick={() => setEdit(false)}>Cancelar</Button>
            <Button variant="primary" onClick={save}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <UserAvatar
            key={draft.photo}
            name={draft.name || name}
            photo={draft.photo}
          />
          <Input
            label="Nome"
            maxLength={80}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Input label="Sessão visitante" value="guest@legacy.com" readOnly />
          <label className="grid gap-1.5 text-xs text-dim">
            Foto do perfil
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void choosePhoto(e.target.files?.[0])}
            />
          </label>
          {draft.photo && (
            <Button size="sm" onClick={() => setDraft({ ...draft, photo: '' })}>
              Remover foto
            </Button>
          )}
          {error && (
            <p role="alert" className="text-danger-fg">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <Modal
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Desconectar Instagram?"
        description="Desconecta esta conta do workspace e remove o token salvo. Seus arquivos e histórico permanecem; tarefas pendentes não poderão publicar."
        footer={
          <>
            <Button onClick={() => setDisconnectOpen(false)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Desconectar
            </Button>
          </>
        }
      >
        {error && (
          <p role="alert" className="text-danger-fg">
            {error}
          </p>
        )}
      </Modal>
    </>
  )
}
