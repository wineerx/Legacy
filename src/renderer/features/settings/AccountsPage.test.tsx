import {it,expect,vi} from 'vitest'
import {screen,within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {mockBridge,renderWithApp} from '../../test-utils'
import {AccountsPage} from './AccountsPage'
it('mostra os métodos reais de cada rede e abre a exportação manual',async()=>{
 const navigate=vi.fn()
 mockBridge({'accounts.instagram':()=>null,'accounts.instagramList':()=>[]})
 renderWithApp(<AccountsPage navigate={navigate}/>)
 expect(await screen.findByText('Nenhuma conta conectada')).toBeVisible()
 const threads=screen.getByRole('article',{name:'Threads'})
 expect(within(threads).getByRole('button',{name:'Conexão indisponível'})).toBeDisabled()
 await userEvent.click(screen.getByRole('button',{name:'Preparar exportação'}))
 expect(navigate).toHaveBeenCalledWith('compose')
})
it('gerencia e desconecta a conta vinculada pelo menu',async()=>{
 const disconnect=vi.fn(()=>null)
 const studio={id:'111',username:'studio',revision:'1',validatedAt:'2026-10-06T12:00:00Z'},second={id:'222',username:'acme',revision:'1',validatedAt:'2026-10-07T12:00:00Z'}
 mockBridge({'accounts.instagram':()=>studio,'accounts.instagramList':()=>[studio,second],'accounts.disconnectInstagram':disconnect,'quota.get':()=>({status:'unknown',reason:null,snapshot:null,limit:null,windowSec:null,breakdown:{official:null,confirmedAfterSnapshot:0,uncertainAfterSnapshot:0,pending:0,candidates:0},availableNow:null,slots:[],overLimit:0})})
 renderWithApp(<AccountsPage navigate={vi.fn()}/>)
 const table=await screen.findByRole('table')
 expect(within(table).getByText('@studio')).toBeVisible()
 expect(within(table).getByText('Conta ativa')).toBeVisible()
 // Every account, including secondary ones, asks before disconnecting.
 await userEvent.click(screen.getByRole('button',{name:'Ações de @acme'}))
 await userEvent.click(screen.getByRole('button',{name:'Desconectar conta'}))
 const dialog=screen.getByRole('dialog',{name:'Desconectar @acme?'})
 expect(disconnect).not.toHaveBeenCalled()
 await userEvent.click(within(dialog).getByRole('button',{name:'Desconectar'}))
 expect(disconnect).toHaveBeenCalledWith({workspaceId:expect.any(String),accountId:'222'})
})
it('escolhe a plataforma e mantém erro de conexão no contexto',async()=>{
 mockBridge({'accounts.instagram':()=>null,'accounts.instagramList':()=>[],'accounts.connectInstagram':()=>{throw {code:'invalid_input',message:'Token expirado. Reconecte.'}}})
 renderWithApp(<AccountsPage navigate={vi.fn()}/>)
 await userEvent.click(await screen.findByRole('button',{name:'Conectar conta'}))
 const dialog=screen.getByRole('dialog',{name:'Conectar uma conta'})
 await userEvent.click(within(dialog).getByRole('button',{name:/Instagram/}))
 await userEvent.type(screen.getByLabelText('Token de acesso Instagram'),'test-token-not-a-secret-123')
 await userEvent.click(screen.getByRole('button',{name:'Verificar e conectar conta'}))
 expect(await screen.findByText('Token expirado. Reconecte.')).toBeVisible()
})
