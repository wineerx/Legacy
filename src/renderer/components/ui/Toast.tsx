import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { cx } from './cx'

type Toast = { id: number; title: string; body?: string; tone?: 'info' | 'error' }
const Ctx = createContext<{ show(t: Omit<Toast, 'id'>): void }>({ show: () => {} })

function ToastItem({ toast, onClose }: { toast: Toast; onClose(id: number): void }) {
  const isError = toast.tone === 'error'
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isError || paused) return
    timer.current = setTimeout(() => onClose(toast.id), 5000)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [isError, paused, toast.id, onClose])

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cx('flex items-start gap-2 rounded-card border bg-panel p-3 shadow-xl', isError ? 'border-danger' : 'border-line')}
    >
      {isError && <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-danger-fg" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{isError && <span className="sr-only">Erro: </span>}{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-xs text-dim">{toast.body}</p>}
      </div>
      <button type="button" aria-label="Fechar notificação" onClick={() => onClose(toast.id)} className="rounded-ctl p-1 text-dim hover:text-fg hover:bg-raised">
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs, { ...t, id }])
  }, [])
  const close = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const value = useMemo(() => ({ show }), [show])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-2">
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {items.filter((t) => t.tone !== 'error').map((t) => <ToastItem key={t.id} toast={t} onClose={close} />)}
        </div>
        <div role="alert" className="flex flex-col gap-2">
          {items.filter((t) => t.tone === 'error').map((t) => <ToastItem key={t.id} toast={t} onClose={close} />)}
        </div>
      </div>
    </Ctx.Provider>
  )
}
export const useToast = () => useContext(Ctx)
