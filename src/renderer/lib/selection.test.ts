import { describe, it, expect } from 'vitest'
import { emptySelection, toggleId, selectPage, selectAllFiltered, selectionCount, isSelected, selectionLabel } from './selection'

describe('selection', () => {
  it('ids individuais e página', () => {
    let s = toggleId(emptySelection(), 'a')
    s = selectPage(s, ['b', 'c'])
    expect(selectionCount(s)).toBe(3)
    expect(selectionLabel(s)).toBe('3 selecionados (nesta página)')
    s = toggleId(s, 'a')
    expect(isSelected(s, 'a')).toBe(false)
  })
  it('todos os filtrados', () => {
    const s = selectAllFiltered(48)
    expect(isSelected(s, 'qualquer')).toBe(true)
    expect(selectionLabel(s)).toBe('Todos os 48 resultados filtrados')
    expect(selectionCount(toggleId(s, 'x'))).toBe(1)
  })
  it('vazio', () => {
    expect(selectionLabel(emptySelection())).toBe('Nenhum selecionado')
  })
})
