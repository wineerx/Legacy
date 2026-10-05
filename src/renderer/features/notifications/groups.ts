import type { NotificationDto } from '@shared/ipc-contract'
export type Category = 'download' | 'publication' | 'system'
export function notificationCategory(n: NotificationDto): Category {
  try { const a = JSON.parse(n.actionJson ?? '{}'); if (['download', 'publication'].includes(a.category)) return a.category } catch {}
  return /baixar|download|busca de|carregar.*reels/i.test(n.title) ? 'download' : /publicar|publicação|postagem/i.test(n.title) ? 'publication' : 'system'
}
export function groupNotifications(notes: NotificationDto[], filter: string) {
  const map = new Map<string, { id: string; category: Category; items: NotificationDto[] }>()
  for (const n of notes) {
    const category = notificationCategory(n)
    if (filter === 'unread' && n.readAt || filter === 'error' && n.kind !== 'error' || ['download', 'publication', 'system'].includes(filter) && category !== filter) continue
    let key = n.id
    try { const a = JSON.parse(n.actionJson ?? '{}'); key = a.groupId ?? a.jobId ?? n.id } catch {}
    const id = `${category}:${key}`
    if (!map.has(id)) map.set(id, { id, category, items: [] })
    map.get(id)!.items.push(n)
  }
  return [...map.values()]
}
