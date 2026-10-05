import { useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient, useJobsChangedInvalidation } from './lib/query'
import { WorkspaceProvider, useWorkspace } from './lib/workspace'
import { onEvent } from './lib/api'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { ToastProvider } from './components/ui'
import { PAGES, type PageKey } from './routes'
import { TutorialProvider } from './features/tutorial/TutorialProvider'
import { Celebration } from './features/achievements/Celebration'
import { MascotProvider, useMascot } from './components/brand/MascotProvider'

function Shell() {
  useJobsChangedInvalidation()
  const { workspace, workspaces, setWorkspaceId } = useWorkspace()
  const [page, setPage] = useState<PageKey>('overview')
  const [collapsed, setCollapsed] = useState(()=>{try{return localStorage.getItem('legacy.sidebarCollapsed')==='true'}catch{return false}})
  const { unread } = useMascot()
  useEffect(() => onEvent('app.navigate', (p) => {
    const { page: next, workspaceId } = (p ?? {}) as { page?: string; workspaceId?: string }
    if (typeof workspaceId === 'string' && workspaces.some((w) => w.id === workspaceId)) setWorkspaceId(workspaceId)
    if (typeof next === 'string' && Object.hasOwn(PAGES, next)) setPage(next as PageKey)
  }), [workspaces])
  const Page = PAGES[page]
  return (
    <TutorialProvider page={page} navigate={setPage}><div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto]">
      <div className="flex min-h-0 min-w-0">
        <Sidebar current={page} onNavigate={setPage} unread={unread} collapsed={collapsed} onToggle={() => setCollapsed((c) => {try{localStorage.setItem('legacy.sidebarCollapsed',String(!c))}catch{/* unavailable */}return !c})} />
        <main tabIndex={-1} className="min-w-0 flex-1 overflow-auto bg-app"><div key={`${workspace.id}:${page}`} className={page === 'profiles' ? 'page-enter h-full' : 'page-enter'}><Page navigate={setPage} /></div></main>
      </div>
      <StatusBar />
      <Celebration />
    </div></TutorialProvider>
  )
}

function WorkspaceShell() {
  const { workspace } = useWorkspace()
  return <MascotProvider key={workspace.id}><Shell /></MascotProvider>
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WorkspaceProvider><WorkspaceShell /></WorkspaceProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
