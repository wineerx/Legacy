import { useInfiniteQuery } from '@tanstack/react-query'
import type { GridQuery } from '@shared/types'
import { call } from '../../lib/api'

const PAGE = 60

export function useGridQuery(q: Omit<GridQuery, 'limit' | 'offset'>, enabled = true) {
  const r = useInfiniteQuery({
    queryKey: ['grid', q],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => call('grid.query', { ...q, limit: PAGE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total && last.items.length === PAGE ? loaded : undefined
    }
  })
  const pages = r.data?.pages ?? []
  return {
    items: pages.flatMap((p) => p.items), total: pages[0]?.total ?? 0, loadedNote: pages[0]?.loadedNote ?? '',
    fetchNextPage: r.fetchNextPage, hasNextPage: r.hasNextPage, isLoading: r.isLoading || r.isFetchingNextPage, isError: r.isError, error: r.error
  }
}
