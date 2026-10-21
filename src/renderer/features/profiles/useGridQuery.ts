import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { GridQuery } from '@shared/types'
import { call } from '../../lib/api'

/** One page of the profile grid; the previous page stays on screen while the next one loads. */
export function useGridQuery(q: Omit<GridQuery, 'limit' | 'offset'>, enabled = true, page = 1, pageSize = 60) {
  const r = useQuery({
    queryKey: ['grid', q, page, pageSize],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => call('grid.query', { ...q, limit: pageSize, offset: (page - 1) * pageSize })
  })
  return {
    items: r.data?.items ?? [], total: r.data?.total ?? 0, loadedNote: r.data?.loadedNote ?? '',
    isLoading: r.isLoading, isFetching: r.isFetching, isError: r.isError, error: r.error
  }
}
