import {it,expect,vi} from 'vitest'
import {screen,within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {mockBridge,renderWithApp} from '../../test-utils'
import {AccountsPage} from './AccountsPage'
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
