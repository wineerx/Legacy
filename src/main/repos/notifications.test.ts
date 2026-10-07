import { expect, it } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from './workspaces'
import { addNotification, deleteNotifications, listNotifications } from './notifications'
it('exclui individual/seleção/todas somente do workspace indicado', () => {
 const db=memDb(); const now=new Date(); const a=createWorkspace(db,{name:'A',timeZone:'UTC'}).id; const b=createWorkspace(db,{name:'B',timeZone:'UTC'}).id
 const make=(workspaceId:string)=>addNotification(db,{workspaceId,kind:'info',title:'T',body:'B'},now)
 const first=make(a), second=make(a), foreign=make(b)
 expect(deleteNotifications(db,a,{ids:[first.id,foreign.id]})).toBe(1)
 expect(listNotifications(db,b,now)).toHaveLength(1)
 expect(deleteNotifications(db,a,{ids:[second.id]})).toBe(1)
 make(a);make(a)
 expect(deleteNotifications(db,a,{all:true})).toBe(2)
 expect(listNotifications(db,b,now)).toHaveLength(1)
})
