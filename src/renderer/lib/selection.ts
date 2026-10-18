import type { GridQuery } from '@shared/types'
import { call } from './api'

export type Selection = { mode: 'ids'; ids: Set<string> } | { mode: 'all'; total: number }

export const emptySelection = (): Selection => ({ mode: 'ids', ids: new Set() })
export const selectAllFiltered = (total: number): Selection => ({ mode: 'all', total })

export function toggleId(s: Selection, id: string): Selection {
  if (s.mode === 'all') return { mode: 'ids', ids: new Set([id]) }
  const ids = new Set(s.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { mode: 'ids', ids }
}

export function selectPage(s: Selection, pageIds: string[]): Selection {
  const ids = s.mode === 'ids' ? new Set(s.ids) : new Set<string>()
  for (const id of pageIds) ids.add(id)
  return { mode: 'ids', ids }
}

export const selectionCount = (s: Selection): number => (s.mode === 'all' ? s.total : s.ids.size)
export const isSelected = (s: Selection, id: string): boolean => (s.mode === 'all' ? true : s.ids.has(id))

export function selectionLabel(s: Selection): string {
  if (s.mode === 'all') return `Todos os ${s.total} resultados filtrados`
  return s.ids.size === 0 ? 'Nenhum selecionado' : `${s.ids.size} selecionados (nesta página)`
}

export async function resolveSelectedIds(s: Selection, q: Omit<GridQuery, 'limit' | 'offset'>): Promise<string[]> {
  if (s.mode === 'ids') return [...s.ids]
  const ids: string[] = []
  for (let offset = 0; offset < s.total; offset += 200) {
    const page = await call('grid.query', { ...q, limit: 200, offset })
    ids.push(...page.items.map((i) => i.id))
    if (page.items.length < 200) break
  }
  return ids
}

let composeIds: string[] = []
export const setComposeSelection = (ids: string[]): void => { composeIds = ids }
export const peekComposeSelection = (): string[] => composeIds
export const clearComposeSelection = (): void => { composeIds = [] }

let libraryFocus: { workspaceId: string; assetId?: string; publicationJobId?: string } | null = null
export const focusLibraryAsset = (workspaceId: string, assetId: string) => { libraryFocus = { workspaceId, assetId } }
export const focusLibraryPublication = (workspaceId: string, publicationJobId: string) => { libraryFocus = { workspaceId, publicationJobId } }
export const takeLibraryFocus = (workspaceId: string) => { const result = libraryFocus?.workspaceId === workspaceId ? libraryFocus : undefined; libraryFocus = null; return result }
