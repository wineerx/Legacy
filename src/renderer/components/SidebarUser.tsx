import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { UserRound, MoreVertical, Settings, LogOut } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '../lib/workspace'
import { useSession } from '../lib/session'
import { UserAvatar } from './ui/UserAvatar'
import { call } from '../lib/api'
import type { PageKey } from '../routes'
import { Button, Modal, Input, Tooltip, useToast } from './ui'

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
  const { workspace } = useWorkspace()
  const toast = useToast()
  const [profile, setProfile] = useState(readProfile)
  const [draft, setDraft] = useState(profile)
  const [edit, setEdit] = useState(false)
  const [error, setError] = useState('')
  const account = useQuery({
    queryKey: ['instagram-account', workspace.id],
    queryFn: () => call('accounts.instagram', { workspaceId: workspace.id })
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
      className={`flex min-w-0 w-full items-center gap-2 rounded-ctl bg-raised py-2 text-left hover:bg-panel data-[state=open]:bg-panel ${collapsed ? 'justify-center px-0' : 'px-2'}`}
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
          <MoreVertical size={14} className="shrink-0 text-dim" aria-hidden />
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
            sideOffset={16}
            collisionPadding={16}
            aria-label="Menu da conta"
            className="ds-dropdown sidebar-user-menu"
          >
            <div className="flex min-w-0 items-center gap-2.5 border-b border-line px-3 py-3">
              <UserAvatar key={profile.photo} name={name} photo={profile.photo} />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-xs">{name}</strong>
                <p className="truncate text-[11px] text-dim">guest@legacy.com</p>
              </div>
            </div>
            <div className="flex flex-col p-1">
            <Popover.Close asChild>
              <button
                className="flex h-8 w-full items-center gap-2.5 rounded-ctl px-2 text-xs hover:bg-raised"
                onClick={() => {
                  setDraft(profile)
                  setError('')
                  setEdit(true)
                }}
              >
                <UserRound size={14} className="shrink-0" aria-hidden />
                Editar perfil local
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button
                aria-current={current === 'settings' ? 'page' : undefined}
                className="flex h-8 w-full items-center gap-2.5 rounded-ctl px-2 text-xs hover:bg-raised aria-[current=page]:bg-raised"
                onClick={() => navigate('settings')}
              >
                <Settings size={14} className="shrink-0" aria-hidden />
                Configurações
              </button>
            </Popover.Close>
            </div>
            <div className="border-t border-line p-1">
            <Popover.Close asChild>
              <button
                className="flex h-9 w-full items-center gap-2.5 rounded-ctl px-2 text-xs text-danger-icon hover:bg-raised"
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
                <LogOut size={14} className="shrink-0 text-danger-icon" aria-hidden />
                Sair
              </button>
            </Popover.Close>
            </div>
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
    </>
  )
}
