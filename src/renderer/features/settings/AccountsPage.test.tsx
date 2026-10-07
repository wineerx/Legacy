import {it,expect,vi} from 'vitest'
import {screen,within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {mockBridge,renderWithApp} from '../../test-utils'
import {AccountsPage} from './AccountsPage'
it('mostra os métodos reais de cada rede e abre a exportação manual',async()=>{
 const navigate=vi.fn()
 mockBridge({'accounts.instagram':()=>null})
 renderWithApp(<AccountsPage navigate={navigate}/>)
 expect(await screen.findByText('Nenhuma conta conectada')).toBeVisible()
 const threads=screen.getByRole('article',{name:'Threads'})
 expect(within(threads).getByRole('button',{name:'Conexão indisponível'})).toBeDisabled()
 await userEvent.click(screen.getByRole('button',{name:'Preparar exportação'}))
 expect(navigate).toHaveBeenCalledWith('compose')
})
it('gerencia e desconecta a conta vinculada pelo menu',async()=>{
 const disconnect=vi.fn(()=>null)
 mockBridge({'accounts.instagram':()=>({id:'ig-1',username:'studio',revision:'1',validatedAt:'2026-10-06T12:00:00Z'}),'accounts.disconnectInstagram':disconnect})
 renderWithApp(<AccountsPage navigate={vi.fn()}/>)
 expect(await screen.findByText('@studio')).toBeVisible()
 await userEvent.click(screen.getByRole('button',{name:'Opções da conta Instagram'}))
 await userEvent.click(screen.getByRole('button',{name:'Desconectar conta'}))
 const dialog=screen.getByRole('dialog',{name:'Desconectar Instagram?'})
 expect(disconnect).not.toHaveBeenCalled()
 await userEvent.click(within(dialog).getByRole('button',{name:'Desconectar'}))
 expect(disconnect).toHaveBeenCalledOnce()
})
it('escolhe a plataforma e mantém erro de conexão no contexto',async()=>{
 mockBridge({'accounts.instagram':()=>null,'accounts.connectInstagram':()=>{throw {code:'invalid_input',message:'Token expirado. Reconecte.'}}})
 renderWithApp(<AccountsPage navigate={vi.fn()}/>)
 await userEvent.click(await screen.findByRole('button',{name:'Conectar conta'}))
 const dialog=screen.getByRole('dialog',{name:'Conectar uma conta'})
 await userEvent.click(within(dialog).getByRole('button',{name:/Instagram/}))
 await userEvent.type(screen.getByLabelText('Token de acesso Instagram'),'test-token-not-a-secret-123')
 await userEvent.click(screen.getByRole('button',{name:'Verificar e conectar conta'}))
 expect(await screen.findByText('Token expirado. Reconecte.')).toBeVisible()
})
