import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  const base = { current: 'library' as const, unread: 3, collapsed: false, onToggle: vi.fn() }

  it('marca a página atual e navega', async () => {
    const onNavigate = vi.fn()
    render(<Sidebar {...base} onNavigate={onNavigate} />)
    expect(screen.getByRole('link', { name: 'Biblioteca' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('link', { name: 'Perfis' }))
    expect(onNavigate).toHaveBeenCalledWith('profiles')
  })

  it('mostra não lidas nas notificações', () => {
    render(<Sidebar {...base} onNavigate={vi.fn()} />)
    expect(screen.getByRole('link', { name: /Notificações/ })).toHaveTextContent('3')
  })

  it('busca filtra itens', async () => {
    render(<Sidebar {...base} onNavigate={vi.fn()} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar no menu' }), 'fila')
    expect(screen.getByRole('link', { name: 'Fila' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Biblioteca' })).toBeNull()
  })

  it('recolhe mantendo nomes acessíveis', async () => {
    const onToggle = vi.fn()
    render(<Sidebar {...base} collapsed onToggle={onToggle} onNavigate={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Biblioteca' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expandir menu' }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('ignora a busca quando recolhido', async () => {
    const { rerender } = render(<Sidebar {...base} onNavigate={vi.fn()} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar no menu' }), 'fila')
    expect(screen.queryByRole('link', { name: 'Biblioteca' })).toBeNull()
    rerender(<Sidebar {...base} collapsed onNavigate={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Biblioteca' })).toBeInTheDocument()
  })

  it('recolhido inclui contagem nas notificações', () => {
    render(<Sidebar {...base} collapsed onNavigate={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Notificações, 3 não lidas' })).toBeInTheDocument()
  })
})
