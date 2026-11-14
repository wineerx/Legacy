import type { ReactNode } from 'react'
import { ResizableAside } from '../../components/ui'

/** Profile list column: 280 px by default, 240 to 400 px through the divider, saved per device. */
export function ProfileSidebar({ children }: { children: ReactNode }) {
  return <ResizableAside storageKey="legacy.profiles.sidebarWidth" label="Ajustar largura da lista de perfis"
    className="profiles-sidebar w-full border-b border-line xl:h-full xl:border-r xl:border-b-0" asideClassName="gap-3 p-4">
    {children}
  </ResizableAside>
}
