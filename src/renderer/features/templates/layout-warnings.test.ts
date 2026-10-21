import { expect, it } from 'vitest'
import { blankLayout, newElement } from '@shared/visual-layout'
import { layoutWarnings } from './layout-warnings'

const scene = (elements = blankLayout().elements, context = {}) => ({ version: 2 as const, layout: { ...blankLayout(), elements }, context })

it('warns about clipped elements but ignores hidden ones', () => {
  const logo = { ...newElement('image', 'logo'), x: 1000, width: 200 }
  expect(layoutWarnings(scene([logo]))).toEqual(['Logo / avatar logo ultrapassa o canvas e será recortado.'])
  expect(layoutWarnings(scene([{ ...logo, visible: false }]))).toEqual([])
  expect(layoutWarnings(scene())).toEqual([])
})

it('asks for missing local variables once; caption comes from each item', () => {
  const text = { ...newElement('text', 't'), text: '{{username}} · {{ username }} · {{caption}} · {{profile_name}}' }
  expect(layoutWarnings(scene([text], { profile_name: 'Página' }))).toEqual(['Preencha username em Textos dinâmicos antes de agendar.'])
  expect(layoutWarnings(scene([text], { profile_name: 'Página', username: '  ' }))).toHaveLength(1)
  expect(layoutWarnings(scene([text], { profile_name: 'Página', username: 'qa' }))).toEqual([])
})
