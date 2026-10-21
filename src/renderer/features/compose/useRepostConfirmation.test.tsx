import { expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { useRepostConfirmation } from './useRepostConfirmation'
it('repostagem intencional exige checkbox e confirmação, sem perder o destino', async () => {
 const confirm=vi.fn()
 mockBridge({'publications.checkRepost':()=>[{id:'a',name:'Vídeo A',reason:'Este vídeo já foi publicado nesta conta.'}]})
 function Probe(){const guard=useRepostConfirmation(WS_ID,'123');return <><button onClick={()=>void guard.review({assetIds:['a']},confirm)}>Agendar</button>{guard.modal}</>}
 renderWithApp(<Probe/>)
 await userEvent.click(await screen.findByRole('button',{name:'Agendar'}))
 const button=await screen.findByRole('button',{name:'Publicar novamente'})
 expect(button).toBeDisabled();expect(confirm).not.toHaveBeenCalled()
 await userEvent.click(screen.getByRole('checkbox',{name:'Confirmo a repostagem intencional nesta conta'}))
 await userEvent.click(button)
 expect(confirm).toHaveBeenCalledWith(true)
})
