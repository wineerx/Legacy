import { useEffect, useState } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { queryClient, useJobsChangedInvalidation } from './lib/query'
import { WorkspaceProvider, useWorkspace } from './lib/workspace'
import { call, onEvent } from './lib/api'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { ToastProvider } from './components/ui'
import { PAGES, type PageKey } from './routes'
import { TutorialProvider } from './features/tutorial/TutorialProvider'

function Shell() {
  useJobsChangedInvalidation()
  const { workspace, workspaces, setWorkspaceId } = useWorkspace()
  const [page, setPage] = useState<PageKey>('overview')
  const [collapsed, setCollapsed] = useState(false)
  const notes = useQuery({ queryKey: ['notifications', workspace.id], queryFn: () => call('notifications.list', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const unread = notes.data?.filter((n) => !n.readAt).length ?? 0
  useEffect(() => onEvent('app.navigate', (p) => {
    const { page: next, workspaceId } = (p ?? {}) as { page?: string; workspaceId?: string }
    if (typeof workspaceId === 'string' && workspaces.some((w) => w.id === workspaceId)) setWorkspaceId(workspaceId)
    if (typeof next === 'string' && Object.hasOwn(PAGES, next)) setPage(next as PageKey)
  }), [workspaces])
  const Page = PAGES[page]
  return (
    <TutorialProvider page={page} navigate={setPage}><div className="grid h-full grid-rows-[1fr_auto]">
      <div className="flex min-h-0">
        <Sidebar current={page} onNavigate={setPage} unread={unread} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <main tabIndex={-1} className="min-w-0 flex-1 overflow-auto bg-app"><div key={`${workspace.id}:${page}`} className="page-enter"><Page navigate={setPage} /></div></main>
      </div>
      <StatusBar />
    </div></TutorialProvider>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WorkspaceProvider><Shell /></WorkspaceProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
