import { cx } from './ui'
import { LegacyMascot } from './brand/LegacyMascot'
import { useMascot } from './brand/MascotProvider'

export function StatusBar() {
  const { workerAlive, running, queued, state, message } = useMascot()
  return (
    <footer className="flex min-w-0 items-center gap-3 border-t border-line bg-side px-3 py-1 text-[11px] text-dim">
      <span title={message}><LegacyMascot state={state} size={32} animated={false} /></span>
      <span className="flex items-center gap-1.5"><span className={cx('h-2 w-2 rounded-full', workerAlive ? 'bg-ok' : 'bg-danger')} />{workerAlive ? 'Processador ativo' : 'Processador reiniciando'}</span>
      <span>{running} em execução · {queued} na fila</span>
      <span className="ml-auto min-w-0 truncate" title={message}>{message}</span>
    </footer>
  )
}
