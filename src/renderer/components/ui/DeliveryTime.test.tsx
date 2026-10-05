import {describe,it,expect} from 'vitest'
import {deliveryError} from './DeliveryTime'
describe('delivery time',()=>{
 const now=new Date('2026-10-05T20:00:00Z')
 it('valida passado no fuso e o limite de todo o lote',()=>{
  expect(deliveryError('2026-10-05T16:30','America/Sao_Paulo',now)).toMatch(/futuro/)
  expect(deliveryError('2026-10-05T18:30','America/Sao_Paulo',now)).toBeUndefined()
  expect(deliveryError('2027-01-03T16:30','America/Sao_Paulo',now,3,60)).toMatch(/90 dias/)
 })
 it('rejeita valor incompleto e intervalo inválido',()=>{
  expect(deliveryError('','UTC',now)).toMatch(/Escolha/)
  expect(deliveryError('2026-10-05T18:30','UTC',now,2,NaN)).toMatch(/intervalo/)
 })
})
