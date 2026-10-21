import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { call, onEvent } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { useToast } from '../../components/ui'

export function PublicationCelebration() {
  const { workspace } = useWorkspace()
  const toast = useToast()
  const qc = useQueryClient()
  const pending = useRef(false)
  const [burst, setBurst] = useState(0)
  const feedback = useQuery({
    queryKey: ['publication-feedback', workspace.id],
    queryFn: () => call('publications.feedback', { workspaceId: workspace.id }),
    refetchInterval: 5000
  })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = onEvent('jobs.changed', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void qc.invalidateQueries({
          queryKey: ['publication-feedback', workspace.id]
        })
      }, 1200)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [workspace.id, qc])
  useEffect(() => {
    if (!feedback.data?.length || pending.current) return
    pending.current = true
    const rows = feedback.data
    void call('publications.acknowledge', {
      workspaceId: workspace.id,
      ids: rows.map((r) => r.jobId)
    })
      .then(() => {
        toast.show({
          title:
            rows.length === 1
              ? `Reel publicado em @${rows[0].username}`
              : `${rows.length} Reels publicados`,
          body: 'Publicação confirmada pelo Instagram.'
        })
        setBurst((b) => b + 1)
        return qc.invalidateQueries({
          queryKey: ['publication-feedback', workspace.id]
        })
      })
      .catch(() => {})
      .finally(() => {
        pending.current = false
      })
  }, [feedback.data, workspace.id, qc, toast])
  useEffect(() => {
    if (!burst) return
    const timer = setTimeout(() => setBurst(0), 1500)
    return () => clearTimeout(timer)
  }, [burst])
  return burst ? (
    <div key={burst} className="publication-confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i % 5) * 0.04}s`,
            background: ['#a4c8ef', '#e5e5e5', '#a3deca'][i % 3]
          }}
        />
      ))}
    </div>
  ) : null
}
