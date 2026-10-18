import { renderWithApp, mockBridge } from '../test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  beforeEach(() => mockBridge({}))
  const base = { current: 'library' as const, unread: 3, collapsed: false, onToggle: vi.fn() }

  it('marca a página atual e navega', async () => {
    const onNavigate = vi.fn()
    renderWithApp(<Sidebar {...base} onNavigate={onNavigate} />)
    expect(await screen.findByRole('link', { name: 'Biblioteca' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('link', { name: 'Perfis' }))
    expect(onNavigate).toHaveBeenCalledWith('profiles')
  })

  it('mostra não lidas nas notificações', async () => {
    renderWithApp(<Sidebar {...base} onNavigate={vi.fn()} />)
    expect(await screen.findByRole('link', { name: /Notificações/ })).toHaveTextContent('3')
  })

  it('busca filtra itens', async () => {
    renderWithApp(<Sidebar {...base} onNavigate={vi.fn()} />)
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Buscar no menu' }), 'fila')
    expect(screen.getByRole('link', { name: 'Fila' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Biblioteca' })).toBeNull()
  })

  it('recolhe mantendo nomes acessíveis', async () => {
    const onToggle = vi.fn()
    renderWithApp(<Sidebar {...base} collapsed onToggle={onToggle} onNavigate={vi.fn()} />)
    expect(await screen.findByRole('link', { name: 'Biblioteca' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expandir menu' }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('ignora a busca quando recolhido', async () => {
    const { rerender } = renderWithApp(<Sidebar {...base} onNavigate={vi.fn()} />)
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Buscar no menu' }), 'fila')
    expect(screen.queryByRole('link', { name: 'Biblioteca' })).toBeNull()
    rerender(<Sidebar {...base} collapsed onNavigate={vi.fn()} />)
    expect(await screen.findByRole('link', { name: 'Biblioteca' })).toBeInTheDocument()
  })

  it('recolhido inclui contagem nas notificações', async () => {
    renderWithApp(<Sidebar {...base} collapsed onNavigate={vi.fn()} />)
    expect(await screen.findByRole('link', { name: 'Notificações, 3 não lidas' })).toBeInTheDocument()
  })
})

it.each([0,2,42,120])('notificações permanecem acessíveis ao compactar com %s itens', async unread => {
  renderWithApp(<Sidebar current="library" onToggle={vi.fn()} collapsed unread={unread} onNavigate={vi.fn()}/>)
  const link=await screen.findByRole('link',{name:`Notificações, ${unread} não lidas`})
  expect(link.querySelector('svg')).toBeInTheDocument()
  expect(link).toHaveTextContent(unread>99 ? '99+' : String(unread))
})
