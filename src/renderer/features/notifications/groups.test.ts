import { expect, it } from 'vitest'
import type { NotificationDto } from '@shared/ipc-contract'
import { groupNotifications } from './groups'
const note = (id: string, extra = {}): NotificationDto => ({ id, kind: 'info', title: 'Baixar reel', body: 'Concluído', actionJson: JSON.stringify({ type: 'open_queue', jobId: id, groupId: 'lote-1', category: 'download' }), dueAt: null, readAt: null, createdAt: '2026-10-05T12:00:00Z', ...extra })
it('agrupa um lote e separa categorias', () => {
  const result = groupNotifications([note('1'), note('2'), note('3', { actionJson: JSON.stringify({ groupId: 'lote-1', category: 'publication' }) })], 'all')
  expect(result.map(g => g.items.length)).toEqual([2, 1])
})
it('filtros de não lidas e falhas não incluem outros eventos', () => {
  const notes = [note('1'), note('2', { readAt: '2026-10-05T12:00:00Z', kind: 'error' })]
  expect(groupNotifications(notes, 'unread')[0].items.map(n => n.id)).toEqual(['1'])
  expect(groupNotifications(notes, 'error')[0].items.map(n => n.id)).toEqual(['2'])
})
it('JSON inválido e eventos antigos permanecem visíveis', () => {
  expect(groupNotifications([note('1', { actionJson: 'bad' }), note('2', { actionJson: null })], 'download')).toHaveLength(2)
})
