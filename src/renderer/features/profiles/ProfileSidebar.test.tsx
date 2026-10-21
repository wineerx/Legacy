import { afterEach, beforeEach, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProfileSidebar } from './ProfileSidebar'

const key = 'legacy.profiles.sidebarWidth'
beforeEach(() => localStorage.removeItem(key))
afterEach(() => localStorage.removeItem(key))

it('ajusta pelo teclado, respeita limites e recupera a largura salva', () => {
  const first = render(<ProfileSidebar>Perfis</ProfileSidebar>)
  const handle = screen.getByRole('separator')
  expect(handle).toHaveAttribute('aria-valuenow', '280')
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(handle).toHaveAttribute('aria-valuenow', '296')
  expect(localStorage.getItem(key)).toBe('296')
  first.unmount()
  render(<ProfileSidebar>Perfis</ProfileSidebar>)
  const restored = screen.getByRole('separator')
  expect(restored).toHaveAttribute('aria-valuenow', '296')
  fireEvent.keyDown(restored, { key: 'End' })
  fireEvent.keyDown(restored, { key: 'ArrowRight' })
  expect(restored).toHaveAttribute('aria-valuenow', '400')
  fireEvent.keyDown(restored, { key: 'Home' })
  fireEvent.keyDown(restored, { key: 'ArrowLeft' })
  expect(restored).toHaveAttribute('aria-valuenow', '240')
  fireEvent.doubleClick(restored)
  expect(restored).toHaveAttribute('aria-valuenow', '280')
  expect(localStorage.getItem(key)).toBe('280')
})

it('ignora preferências inválidas e limita valores antigos fora da faixa', () => {
  localStorage.setItem(key, 'broken')
  const first = render(<ProfileSidebar>Perfis</ProfileSidebar>)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '280')
  first.unmount()
  localStorage.setItem(key, '9999')
  render(<ProfileSidebar>Perfis</ProfileSidebar>)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '400')
})
