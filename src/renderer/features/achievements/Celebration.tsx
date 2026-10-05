import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trophy, X } from 'lucide-react'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { ActionIcon } from '../../components/ActionIcon'

export function Celebration() {
  const { workspace } = useWorkspace(); const qc = useQueryClient()
  const [title, setTitle] = useState<string | null>(null)
  const pending = useRef(false)
  const result = useQuery({ queryKey: ['achievements', workspace.id], queryFn: () => call('achievements.get', { workspaceId: workspace.id }), refetchInterval: 5000 })
  useEffect(() => {
    if (!result.data || pending.current) return
    const fresh = result.data.challenges.filter(c => c.unlocked && !result.data.acknowledged.includes(c.id))
    if (!fresh.length) return
    pending.current = true
    void call('achievements.acknowledge', { workspaceId: workspace.id, ids: fresh.map(c => c.id) }).then(() => {
      setTitle(fresh.length === 1 ? fresh[0].title : `${fresh.length} novas conquistas`)
      void qc.invalidateQueries({ queryKey: ['achievements', workspace.id] })
    }).catch(() => {}).finally(() => { pending.current = false })
  }, [result.data, workspace.id])
  useEffect(() => { setTitle(null) }, [workspace.id])
  useEffect(() => { if (!title) return; const timer = setTimeout(() => setTitle(null), 6000); return () => clearTimeout(timer) }, [title])
  return title ? <aside role="status" className="celebration fixed right-6 bottom-12 z-50 flex max-w-[calc(100vw-3rem)] items-center gap-4 rounded-card border border-line-strong bg-raised p-4 shadow-xl"><Trophy size={28} className="celebration-icon" /><div><p className="text-xs text-dim">Conquista desbloqueada</p><p className="font-semibold">{title}</p></div><ActionIcon label="Fechar celebração" variant="ghost" onClick={() => setTitle(null)}><X size={16} /></ActionIcon></aside> : null
}
