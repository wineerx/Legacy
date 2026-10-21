import { Profiler, useEffect, useState, type ProfilerOnRenderCallback } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient, useJobsChangedInvalidation } from './lib/query'
import { WorkspaceProvider, useWorkspace } from './lib/workspace'
import { GuestSessionProvider, useSession } from './lib/session'
import { PublicationCelebration } from './features/achievements/PublicationCelebration'
import { onEvent } from './lib/api'
import { Sidebar } from './components/Sidebar'
import { DiagnosticPanel } from './components/DiagnosticPanel'
import { ToastProvider } from './components/ui'
import { PAGES, type PageKey } from './routes'
import { TutorialProvider } from './features/tutorial/TutorialProvider'
import { Celebration } from './features/achievements/Celebration'
import { MascotProvider, useMascot } from './components/brand/MascotProvider'

declare const __LEGACY_PERF_DEBUG__: boolean
const perfDebug = typeof __LEGACY_PERF_DEBUG__ !== 'undefined' && __LEGACY_PERF_DEBUG__
const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
  const target = window as unknown as {__legacyReactPerf?: unknown[]}
  const samples = target.__legacyReactPerf ??= []
  samples.push({id, phase, actualDuration, baseDuration, startTime, commitTime})
  if(samples.length > 10000) samples.shift()
}

function Shell() {
  useJobsChangedInvalidation()
  const { workspace, workspaces, setWorkspaceId } = useWorkspace()
  const { navigation } = useSession()
  const [page, setPage] = useState<PageKey>('overview')
  const [collapsed, setCollapsed] = useState(()=>{try{return localStorage.getItem('legacy.sidebarCollapsed')==='true'}catch{return false}})
  const { unread } = useMascot()
  useEffect(() => onEvent('app.navigate', (p) => {
    const { page: next, workspaceId } = (p ?? {}) as { page?: string; workspaceId?: string }
    if (typeof workspaceId === 'string' && workspaces.some((w) => w.id === workspaceId)) setWorkspaceId(workspaceId)
    if (typeof next === 'string' && Object.hasOwn(PAGES, next)) setPage(next as PageKey)
  }), [workspaces])
  useEffect(() => {
    if (!navigation) return
    if (navigation.workspaceId && workspaces.some(w => w.id === navigation.workspaceId)) setWorkspaceId(navigation.workspaceId)
    if (navigation.page && Object.hasOwn(PAGES, navigation.page)) setPage(navigation.page as PageKey)
  }, [navigation, workspaces])
  const Page = PAGES[page]
  return (
    <TutorialProvider page={page} navigate={setPage}><div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto]">
      <div className="flex min-h-0 min-w-0">
        <Profiler id="Sidebar" onRender={perfDebug ? onRender : () => {}}><Sidebar current={page} onNavigate={setPage} unread={unread} collapsed={collapsed} onToggle={() => setCollapsed((c) => {try{localStorage.setItem('legacy.sidebarCollapsed',String(!c))}catch{/* unavailable */}return !c})} /></Profiler>
        <main tabIndex={-1} className="min-w-0 flex-1 overflow-auto bg-app"><div key={`${workspace.id}:${page}`} className={page === 'profiles' ? 'page-enter h-full' : 'page-enter'}><Profiler id={page} onRender={perfDebug ? onRender : () => {}}><Page navigate={setPage} /></Profiler></div></main>
      </div>
      <Profiler id="Diagnostics" onRender={perfDebug ? onRender : () => {}}><DiagnosticPanel navigate={setPage} /></Profiler>
      <Celebration />
      <PublicationCelebration />
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
        <GuestSessionProvider><WorkspaceProvider><WorkspaceShell /></WorkspaceProvider></GuestSessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
