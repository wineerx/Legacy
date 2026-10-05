import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { onEvent } from './api'

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 } } })

export function useJobsChangedInvalidation(): void {
  const qc = useQueryClient()
  useEffect(() => onEvent('jobs.changed', () => { void qc.invalidateQueries() }), [qc])
}
