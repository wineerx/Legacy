import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Toaster, toast as sonner } from 'sonner'
import { LegacyMascot } from '../brand/LegacyMascot'
import './toast.css'

type Toast = { title: string; body?: string; tone?: 'info' | 'error' }
const Ctx = createContext<{ show(t: Toast): void }>({ show: () => {} })

function ToastContent({ toast, id }: { toast: Toast; id: number | string }) {
  const isError = toast.tone === 'error'
  return (
    <div role={isError ? 'alert' : 'status'} className="flex items-center gap-2 p-3">
      <LegacyMascot state={isError ? 'error' : 'notification'} size={36} decorative animated={false} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{isError && <span className="sr-only">Erro: </span>}{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-xs text-dim">{toast.body}</p>}
      </div>
      <button type="button" aria-label="Fechar notificação" onClick={() => sonner.dismiss(id)} className="self-start rounded-ctl p-1 text-dim hover:text-fg hover:bg-raised">
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const toasterId = useId()
  const [focused, setFocused] = useState(false)
  const ids = useRef(new Set<number | string>())
  useEffect(() => () => {
    ids.current.forEach(id => sonner.dismiss(id))
    ids.current.clear()
  }, [])
  const show = useCallback((t: Toast) => {
    const forget = ({ id }: { id: number | string }) => { ids.current.delete(id) }
    const id = sonner.custom(id => <ToastContent toast={t} id={id} />, {
      toasterId,
      duration: t.tone === 'error' ? Infinity : 5000,
      onDismiss: forget,
      onAutoClose: forget,
    })
    ids.current.add(id)
  }, [toasterId])
  const value = useMemo(() => ({ show }), [show])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}>
        <Toaster
          id={toasterId}
          className="legacy-toaster"
          theme="dark"
          position="bottom-right"
          offset={{ bottom: 40, right: 16 }}
          mobileOffset={{ bottom: 40, right: 16, left: 16 }}
          style={{ '--width': '320px' } as CSSProperties}
          expand={focused}
          visibleToasts={3}
          gap={8}
          toastOptions={{ className: 'legacy-toast' }}
          containerAriaLabel="Notificações"
        />
      </div>
    </Ctx.Provider>
  )
}
export const useToast = () => useContext(Ctx)
