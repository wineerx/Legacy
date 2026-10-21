import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileListItem } from './ProfileListItem'

const profile = { id: 'p', platform: 'instagram' as const, username: 'example', url: 'https://instagram.com/example/', connected: false, lastSyncedAt: null }

it('revela o arquivo pelo teclado e permite fechar ou arquivar sem selecionar o perfil', async () => {
  const onArchive = vi.fn(), onSelect = vi.fn()
  render(<ul><ProfileListItem profile={profile} active={false} onArchive={onArchive} onSelect={onSelect} /></ul>)
  const card = screen.getByRole('button', { name: '@example' })
  fireEvent.keyDown(card, { key: 'ArrowRight' })
  expect(card).toHaveStyle({ transform: 'translateX(64px)' })
  expect(screen.getByRole('button', { name: 'Arquivar @example' })).toHaveAttribute('tabindex', '0')
  fireEvent.keyDown(card, { key: 'Escape' })
  expect(card).toHaveStyle({ transform: 'translateX(0px)' })
  await userEvent.click(screen.getByRole('button', { name: 'Opções de @example' }))
  await userEvent.click(screen.getByRole('button', { name: 'Arquivar @example' }))
  expect(onArchive).toHaveBeenCalledOnce()
  expect(onSelect).not.toHaveBeenCalled()
})
