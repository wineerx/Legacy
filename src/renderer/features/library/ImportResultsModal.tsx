import type { ImportResultDto } from '@shared/ipc-contract'
import { Button, Modal } from '../../components/ui'

const STATUS = { imported: 'Importado', duplicate: 'Já estava na biblioteca', rejected: 'Recusado' } as const

export function ImportResultsModal({ results, onClose }: { results: ImportResultDto[] | null; onClose(): void }) {
  return (
    <Modal open={results !== null} onOpenChange={(o) => !o && onClose()} title="Resultado da importação"
      description="Vídeos com aviso foram importados. Os com erro de formato ficam na biblioteca, mas não podem ser exportados."
      footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
      <ul className="flex flex-col gap-2">
        {results?.map((r, i) => (
          <li key={`${i}-${r.path}`} className="rounded-ctl border border-line p-2.5 text-sm">
            <p className="font-medium">{r.path.split(/[\\/]/).pop()} — {STATUS[r.status]}</p>
            {[...r.errors, ...r.warnings].map((m, j) => <p key={`${j}-${m}`} className="mt-0.5 text-xs text-dim">{m}</p>)}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
