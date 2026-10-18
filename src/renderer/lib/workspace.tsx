import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { WorkspaceDto } from '@shared/ipc-contract'
import { call } from './api'
import { StartupScreen } from '../components/brand/StartupScreen'

type Value = { workspace: WorkspaceDto; workspaces: WorkspaceDto[]; setWorkspaceId(id: string): void; workerAlive: boolean; dataDir: string; buildCommit?: string; buildTime?: string }
const Ctx = createContext<Value | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: () => call('app.bootstrap', {}), refetchInterval: 10_000 })
  const [id, setId] = useState<string | null>(() => { try { return localStorage.getItem('workspaceId') } catch { return null } })
  if (boot.isError) return <StartupScreen error="Não foi possível iniciar. Feche e abra o Legacy de novo." />
  if (!boot.data) return <StartupScreen />
  if (boot.data.workspaces.length === 0) return <StartupScreen error="Nenhum workspace encontrado. Feche e abra o Legacy de novo." />
  const workspace = boot.data.workspaces.find((w) => w.id === id) ?? boot.data.workspaces[0]
  const setWorkspaceId = (next: string) => { setId(next); try { localStorage.setItem('workspaceId', next) } catch { /* armazenamento indisponível */ } }
  return <Ctx.Provider value={{ workspace, workspaces: boot.data.workspaces, setWorkspaceId, workerAlive: boot.data.workerAlive, dataDir: boot.data.dataDir, buildCommit: boot.data.buildCommit, buildTime: boot.data.buildTime }}>{children}</Ctx.Provider>
}

export function useWorkspace(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace fora do WorkspaceProvider')
  return v
}
