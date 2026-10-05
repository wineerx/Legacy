import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MediaPreview } from './MediaPreview'
import type { GridItem } from '@shared/types'
const item: GridItem = { id: 'p', kind: 'remote', caption: 'Teste', thumbnailPath: null, permalink: 'https://www.instagram.com/reel/TEST/', postedAt: null, durationMs: null, metrics: { views: null, likes: null, comments: null }, badges: [] }
describe('player interno', () => {
  it('prefere o arquivo local e só abre a origem por ação explícita', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<MediaPreview item={{ ...item, filePath: 'C:/Legacy/video.mp4', videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Player de vídeo')).toHaveAttribute('src', 'legacy-media://file/C%3A%2FLegacy%2Fvideo.mp4')
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ver origem no Instagram' }))
    expect(open).toHaveBeenCalledWith(item.permalink, '_blank')
    open.mockRestore()
  })
  it('recusa uma URL fora dos CDNs e mantém a visualização no Legacy', () => {
    render(<MediaPreview item={{ ...item, videoUrl: 'https://localhost/video.mp4' }} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Player de vídeo')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('ainda não tem vídeo disponível')
  })
  it('mostra erro recuperável sem redirect quando a reprodução falha', () => {
    render(<MediaPreview item={{ ...item, videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }} onClose={vi.fn()} />)
    fireEvent.error(screen.getByLabelText('Player de vídeo'))
    expect(screen.getByRole('status')).toHaveTextContent('URL pode ter expirado')
  })
})
