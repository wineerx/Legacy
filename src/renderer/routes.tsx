import type { ReactElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import { LayoutGrid, UserSearch, Library, PenSquare, Megaphone, CalendarDays, ListOrdered, Link2, Bell, Settings, BookOpen } from 'lucide-react'
import { ComingSoon } from './components/ComingSoon'
import { LibraryPage } from './features/library/LibraryPage'
import { ComposePage } from './features/compose/ComposePage'
import { ProfilesPage } from './features/profiles/ProfilesPage'
import { OverviewPage } from './features/onboarding/OverviewPage'
import { QueuePage } from './features/queue/QueuePage'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TutorialPage } from './features/tutorial/TutorialPage'

export type PageKey = 'overview' | 'profiles' | 'library' | 'compose' | 'campaigns' | 'calendar' | 'queue' | 'accounts' | 'notifications' | 'settings' | 'tutorial'
export type PageProps = { navigate(p: PageKey): void }

export const NAV: { key: PageKey; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: 'Visão geral', icon: LayoutGrid },
  { key: 'profiles', label: 'Perfis', icon: UserSearch },
  { key: 'library', label: 'Biblioteca', icon: Library },
  { key: 'compose', label: 'Criar postagem', icon: PenSquare },
  { key: 'campaigns', label: 'Campanhas', icon: Megaphone },
  { key: 'calendar', label: 'Calendário', icon: CalendarDays },
  { key: 'queue', label: 'Fila', icon: ListOrdered },
  { key: 'accounts', label: 'Contas', icon: Link2 },
  { key: 'notifications', label: 'Notificações', icon: Bell },
  { key: 'tutorial', label: 'Tutoriais', icon: BookOpen }
]
export const SETTINGS_NAV = { key: 'settings' as const, label: 'Configurações', icon: Settings }

const PHASE_D = 'Campanhas e calendário chegam junto com a publicação agendada por API.'
const PHASE_B = 'A conexão oficial com o Instagram chega na próxima versão. Enquanto isso, importe vídeos do PC e métricas por CSV.'

export const PAGES: Record<PageKey, (p: PageProps) => ReactElement> = {
  overview: OverviewPage,
  profiles: ProfilesPage,
  library: LibraryPage,
  compose: ComposePage,
  campaigns: () => <ComingSoon title="Campanhas" reason={PHASE_D} />,
  calendar: () => <ComingSoon title="Calendário" reason={PHASE_D} />,
  queue: QueuePage,
  accounts: () => <ComingSoon title="Contas" reason={PHASE_B} />,
  notifications: NotificationsPage,
  settings: SettingsPage,
  tutorial: TutorialPage
}
