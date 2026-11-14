import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FacetField, FilterPanel, FilterToggle, OptionList, ResizableAside, useFilterPanel, type FilterGroupDef } from './index'

afterEach(() => localStorage.clear())

const STATES = [{ value: 'ready', label: 'Prontos' }, { value: 'scheduled', label: 'Agendados' }, { value: 'failed', label: 'Com erro' }]

it('remover uma etiqueta do campo tracejado tira só aquela opção e não abre a lista', async () => {
  const onChange = vi.fn()
  render(<FacetField label="Estado" multiple options={STATES} value={['ready', 'scheduled']} onChange={onChange} />)
  const field = screen.getByRole('group', { name: 'Estado' })
  expect(within(field).getByText('Prontos')).toBeInTheDocument()
  expect(within(field).getByText('Agendados')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remover Agendados de Estado' }))
  expect(onChange).toHaveBeenCalledWith(['ready'])
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('lista múltipla alterna opções e lista longa ganha busca', async () => {
  function Host() {
    const [value, setValue] = useState<string[]>([])
    return <OptionList label="Perfil de origem" multiple value={value} onChange={setValue}
      options={Array.from({ length: 8 }, (_, i) => ({ value: `p${i}`, label: `@perfil${i}` }))} />
  }
  render(<Host />)
  await userEvent.click(screen.getByRole('checkbox', { name: '@perfil1' }))
  await userEvent.click(screen.getByRole('checkbox', { name: '@perfil3' }))
  expect(screen.getByRole('checkbox', { name: '@perfil1' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '@perfil3' })).toBeChecked()
  await userEvent.type(screen.getByLabelText('Buscar em perfil de origem'), 'perfil3')
  expect(screen.queryByRole('checkbox', { name: '@perfil1' })).toBeNull()
  expect(screen.getByRole('checkbox', { name: '@perfil3' })).toBeChecked()
})

function Panel({ count = 0, onClearAll = () => {} }: { count?: number; onClearAll?(): void }) {
  const state = useFilterPanel('legacy.test.filters', true)
  const groups: FilterGroupDef[] = [
    { id: 'state', title: 'Estado', chips: [], keywords: ['Prontos', 'Agendados'], body: <p>Lista de estados</p> },
    { id: 'duration', title: 'Duração', chips: [{ key: '30', label: 'Até 30 s', remove: () => {} }], keywords: ['Até 15 s', 'Até 30 s'], body: <p>Faixas de duração</p> }
  ]
  return <><FilterToggle state={state} count={count} /><FilterPanel state={state} groups={groups} count={count} onClearAll={onClearAll} total={12} noun="vídeos" /></>
}

it('painel mostra contagem por grupo, busca filtros e limpa tudo', async () => {
  const onClearAll = vi.fn()
  const { unmount } = render(<Panel count={1} onClearAll={onClearAll} />)
  const panel = screen.getByRole('complementary', { name: 'Filtros' })
  expect(within(panel).getByRole('button', { name: 'Duração (1)' })).toBeInTheDocument()
  expect(within(panel).getByText('12 vídeos')).toBeInTheDocument()
  await userEvent.type(within(panel).getByLabelText('Buscar filtros'), 'agend')
  expect(within(panel).getByText('Lista de estados')).toBeInTheDocument()
  expect(within(panel).queryByText('Faixas de duração')).toBeNull()
  await userEvent.clear(within(panel).getByLabelText('Buscar filtros'))
  await userEvent.type(within(panel).getByLabelText('Buscar filtros'), 'xyz')
  expect(within(panel).getByText('Nenhum filtro encontrado')).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Limpar todos' }))
  expect(onClearAll).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Filtros (1 ativos)' }))
  expect(screen.queryByRole('complementary', { name: 'Filtros' })).toBeNull()
  unmount()
  render(<Panel />)
  expect(screen.queryByRole('complementary', { name: 'Filtros' })).toBeNull()
})

it('Limpar todos fica desabilitado sem filtros', () => {
  render(<Panel />)
  expect(screen.getByRole('button', { name: 'Limpar todos' })).toBeDisabled()
})

it('divisor à direita cresce para a esquerda', () => {
  render(<ResizableAside side="right" storageKey="legacy.test.width" label="Ajustar largura dos filtros">Filtros</ResizableAside>)
  const handle = screen.getByRole('separator', { name: 'Ajustar largura dos filtros' })
  fireEvent.keyDown(handle, { key: 'ArrowLeft' })
  expect(handle).toHaveAttribute('aria-valuenow', '296')
  fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
  expect(handle).toHaveAttribute('aria-valuenow', '264')
})
