import { Notification } from 'electron'
import type { Db } from './db/client'
import { dueUnshown, markShown } from './repos/notifications'
import { getSetting } from './repos/settings'

// Referências fortes: sem isso o GC pode descartar o toast antes do clique.
const live = new Set<Notification>()

export function startReminders(db: Db, onClick: (workspaceId: string) => void): () => void {
  const tick = () => {
    try {
      const groups = new Map<string, ReturnType<typeof dueUnshown>>()
      for (const n of dueUnshown(db, new Date())) groups.set(n.workspaceId, [...(groups.get(n.workspaceId) ?? []), n])
      for (const [ws, rows] of groups) {
        const saved = getSetting(db, ws, 'notificationPreferences')
        const desktop = saved ? JSON.parse(saved).desktop !== false : true
        if (!desktop || process.env.LEGACY_DISABLE_DESKTOP_NOTIFICATIONS === '1') { rows.forEach((n) => markShown(db, n.id, new Date())); continue }
        if (!Notification.isSupported()) continue
        const n = rows[0]
        const toast = new Notification({ title: rows.length === 1 ? n.title : `${rows.length} novas notificações do Legacy`, body: rows.length === 1 ? n.body : 'Abra a central para acompanhar tarefas e lembretes.' })
        live.add(toast)
        toast.on('click', () => { live.delete(toast); onClick(n.workspaceId) })
        toast.on('close', () => { live.delete(toast) })
        toast.show()
        rows.forEach((n) => markShown(db, n.id, new Date()))
      }
    } catch (e) {
      console.error('[reminders]', e)
    }
  }
  tick()
  const timer = setInterval(tick, 30_000)
  return () => clearInterval(timer)
}
