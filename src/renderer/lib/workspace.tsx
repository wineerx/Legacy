import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { WorkspaceDto } from '@shared/ipc-contract'
import { call } from './api'

type Value = { workspace: WorkspaceDto; workspaces: WorkspaceDto[]; setWorkspaceId(id: string): void; workerAlive: boolean; dataDir: string }
const Ctx = createContext<Value | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: () => call('app.bootstrap', {}), refetchInterval: 10_000 })
  const [id, setId] = useState<string | null>(() => { try { return localStorage.getItem('workspaceId') } catch { return null } })
  if (boot.isError) return <p className="p-6 text-sm text-danger-fg">Não foi possível iniciar. Feche e abra o Legacy de novo.</p>
  if (!boot.data) return <p className="p-6 text-sm text-dim">Abrindo…</p>
  if (boot.data.workspaces.length === 0) return <p className="p-6 text-sm text-danger-fg">Nenhum workspace encontrado. Feche e abra o Legacy de novo.</p>
  const workspace = boot.data.workspaces.find((w) => w.id === id) ?? boot.data.workspaces[0]
  const setWorkspaceId = (next: string) => { setId(next); try { localStorage.setItem('workspaceId', next) } catch { /* armazenamento indisponível */ } }
  return <Ctx.Provider value={{ workspace, workspaces: boot.data.workspaces, setWorkspaceId, workerAlive: boot.data.workerAlive, dataDir: boot.data.dataDir }}>{children}</Ctx.Provider>
}

export function useWorkspace(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace fora do WorkspaceProvider')
  return v
}
