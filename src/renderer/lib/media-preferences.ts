import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { call } from './api'
import { useWorkspace } from './workspace'
import { useToast } from '../components/ui'
export function useMediaPreferences() {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const toast = useToast()
  const view = useQuery({ queryKey: ['setting', workspace.id, 'mediaViewList'], queryFn: () => call('settings.get', { workspaceId: workspace.id, key: 'mediaViewList' }) })
  const banner = useQuery({ queryKey: ['setting', workspace.id, 'mediaShowBanner'], queryFn: () => call('settings.get', { workspaceId: workspace.id, key: 'mediaShowBanner' }) })
  const [optimistic, setOptimistic] = useState<Partial<Record<'mediaViewList' | 'mediaShowBanner', boolean>>>({})
  const clearOptimistic = (key: 'mediaViewList' | 'mediaShowBanner') => setOptimistic(old => { const next = { ...old }; delete next[key]; return next })
  const mutation = useMutation({ mutationFn: ({ key, value }: { key: 'mediaViewList' | 'mediaShowBanner'; value: boolean }) => call('settings.set', { workspaceId: workspace.id, key, value: value ? 'true' : 'false' }),
    onMutate: input => { const key = ['setting', workspace.id, input.key]; const previous = qc.getQueryData<string | null>(key); qc.setQueryData(key, input.value ? 'true' : 'false'); return { previous } },
    onError: (e, input, context) => { clearOptimistic(input.key); qc.setQueryData(['setting', workspace.id, input.key], context?.previous ?? null); toast.show({ title: 'Preferência não salva', body: e instanceof Error ? e.message : undefined, tone: 'error' }) },
    onSuccess: async (_r, input) => { await qc.invalidateQueries({ queryKey: ['setting', workspace.id, input.key] }); clearOptimistic(input.key) } })
  return { list: optimistic.mediaViewList ?? (view.data === 'true'), showBanner: optimistic.mediaShowBanner ?? (banner.data !== 'false'), save: { ...mutation, mutate: (input: { key: 'mediaViewList' | 'mediaShowBanner'; value: boolean }) => { setOptimistic(old => ({ ...old, [input.key]: input.value })); mutation.mutate(input) } } }
}
