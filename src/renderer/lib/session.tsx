import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type CSSProperties
} from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { call, onEvent } from './api'
import { Button } from '../components/ui'
import { LegacyMascot } from '../components/brand/LegacyMascot'

const SessionContext = createContext<{
  exit(): Promise<void>
  navigation: { page?: string; workspaceId?: string } | null
}>({ exit: async () => {}, navigation: null })
export const useSession = () => useContext(SessionContext)

export function GuestSessionProvider({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [navigation, setNavigation] = useState<{
    page?: string
    workspaceId?: string
  } | null>(null)
  const [glow, setGlow] = useState({ x: 50, y: 0 })
  useEffect(() => {
    void call('session.get', {})
      .then((s) => setEntered(s.entered))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }, [])
  useEffect(
    () =>
      onEvent('app.navigate', (p) =>
        setNavigation((p ?? {}) as { page?: string; workspaceId?: string })
      ),
    []
  )
  const enter = async () => {
    setBusy(true)
    setError('')
    try {
      const session = await call('session.enterGuest', {})
      setEntered(session.entered)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível iniciar a sessão local.'
      )
    } finally {
      setBusy(false)
    }
  }
  const exit = async () => {
    await call('session.exit', {})
    setNavigation(null)
    setEntered(false)
  }
  return (
    <SessionContext.Provider value={{ exit, navigation }}>
      {entered ? (
        children
      ) : (
        <main
          className="guest-entry"
          onPointerMove={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect()
            setGlow({
              x: 45 + ((e.clientX - bounds.left) / bounds.width) * 10,
              y: ((e.clientY - bounds.top) / bounds.height) * 8
            })
          }}
          style={
            {
              '--glow-x': `${glow.x}%`,
              '--glow-y': `${glow.y}%`
            } as CSSProperties
          }
        >
          <div className="guest-glow" aria-hidden="true" />
          <section
            className="relative z-10 flex w-full max-w-sm flex-col items-center gap-4 px-6 text-center"
            aria-labelledby="guest-title"
          >
            <div className="mb-10">
              <LegacyMascot
                size={128}
                state="idle"
                accessory="none"
                decorative
              />
            </div>
            <h1
              id="guest-title"
              className="text-2xl font-semibold tracking-tight"
            >
              Entrar no Legacy
            </h1>
            <p className="text-sm text-dim">Continue com uma sessão local</p>
            <Button
              variant="primary"
              className="mt-1 w-56"
              loading={busy}
              onClick={() => void enter()}
            >
              Entrar como visitante{!busy && <ArrowRight size={16} />}
            </Button>
            <p className="flex items-center gap-2 text-xs text-dim">
              <LockKeyhole size={14} />
              Sessão local · modo de desenvolvimento
            </p>
            <p className="text-xs text-dim">A fila aguarda sua entrada.</p>
            {error && (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            )}
          </section>
        </main>
      )}
    </SessionContext.Provider>
  )
}
