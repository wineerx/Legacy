import { useState } from 'react'
import { focusLibraryAsset } from '../../lib/selection'
import type { PageProps } from '../../routes'
import { call } from '../../lib/api'
import { Button, Modal, Checkbox, useToast } from '../../components/ui'
export function useRepostConfirmation(
  workspaceId: string,
  accountId?: string,
  navigate?: PageProps['navigate']
) {
  const toast = useToast()
  const [pending, setPending] = useState<{
    rows: { id: string; name: string; reason: string }[]
    confirm(allow: boolean): void
  } | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [checking, setChecking] = useState(false)
  const review = async (
    input: { assetIds?: string[]; postIds?: string[] },
    confirm: (allow: boolean) => void
  ) => {
    if (checking) return
    if (!accountId) return confirm(false)
    setChecking(true)
    try {
      const rows = await call('publications.checkRepost', {
        workspaceId,
        accountId,
        ...input
      })
      if (!rows.length) confirm(false)
      else {
        setAccepted(false)
        setPending({ rows, confirm })
      }
    } catch (e) {
      toast.show({
        title: 'Não foi possível verificar repostagens',
        body: e instanceof Error ? e.message : undefined,
        tone: 'error'
      })
    } finally {
      setChecking(false)
    }
  }
  const modal = (
    <Modal
      open={!!pending}
      onOpenChange={(open) => !open && setPending(null)}
      title="Possível repostagem"
      description="Revise os vídeos e a conta de destino antes de continuar."
      footer={
        <>
          <Button onClick={() => setPending(null)}>Voltar</Button>
          {navigate && (
            <Button
              onClick={() => {
                const id = pending?.rows[0]?.id
                setPending(null)
                if (id) focusLibraryAsset(workspaceId, id)
                navigate('library')
              }}
            >
              Revisar na Biblioteca
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!accepted}
            onClick={() => {
              const action = pending?.confirm
              setPending(null)
              action?.(true)
            }}
          >
            Publicar novamente
          </Button>
        </>
      }
    >
      <ul className="mb-4 grid max-h-64 gap-3 overflow-y-auto">
        {pending?.rows.map((r) => (
          <li key={r.id} className="ds-summary">
            <strong className="block text-sm">{r.name}</strong>
            <p className="mt-1 text-xs text-warn">{r.reason}</p>
          </li>
        ))}
      </ul>
      <Checkbox
        label="Confirmo a repostagem intencional nesta conta"
        checked={accepted}
        onChange={(e) => setAccepted(e.target.checked)}
      />
      <p className="mt-3 text-xs text-dim">
        Para remover cópias desnecessárias, volte à Biblioteca e use a exclusão
        de vídeos. Arquivos em uso são preservados.
      </p>
    </Modal>
  )
  return { review, modal, checking }
}
