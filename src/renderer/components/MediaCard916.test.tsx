import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MediaCard916 } from './MediaCard916'
import type { GridItem } from '@shared/types'

const item: GridItem = {
  id: 'r1', kind: 'remote', thumbnailPath: null, permalink: 'https://www.instagram.com/reel/AAAAA1/', caption: 'Treino #fitness',
  postedAt: '2026-09-01T00:00:00.000Z', durationMs: 42_000, metrics: { views: 1_299_000, likes: 84_000, comments: null }, badges: ['link', 'favorito']
}

describe('MediaCard916', () => {
  it('mostra métricas compactas e indisponível', () => {
    render(<MediaCard916 item={item} selected={false} onToggleSelect={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'Visualizações: 1,2 mi' })).toBeInTheDocument()
    expect(screen.getByText('1,2 mi')).toBeInTheDocument()
    expect(screen.getByLabelText('Comentários: indisponível')).toHaveAttribute('tabindex', '0')
    expect(screen.getByLabelText('Curtidas: 84 mil')).toBeInTheDocument()
    expect(screen.getByLabelText('Comentários: indisponível')).toHaveTextContent('—')
    expect(screen.getByText('0:42')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Somente link' })).toBeInTheDocument()
  })
  it('checkbox acessível alterna seleção', async () => {
    const onToggle = vi.fn()
    render(<MediaCard916 item={item} selected onToggleSelect={onToggle} />)
    const cb = screen.getByRole('checkbox', { name: 'Selecionar Treino #fitness' })
    expect(cb).toBeChecked()
    await userEvent.click(cb)
    expect(onToggle).toHaveBeenCalledWith('r1')
  })
  it('mantém proporção 9:16', () => {
    render(<MediaCard916 item={item} selected={false} onToggleSelect={vi.fn()} />)
    expect(screen.getByRole('article')).toHaveStyle({ aspectRatio: '9 / 16' })
  })
})
