import { renderWithApp, mockBridge } from '../test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MediaPreview } from './MediaPreview'
import type { GridItem } from '@shared/types'
const item: GridItem = { id: 'p', kind: 'remote', caption: 'Teste', thumbnailPath: null, permalink: 'https://www.instagram.com/reel/TEST/', postedAt: null, durationMs: null, metrics: { views: null, likes: null, comments: null }, badges: [] }
describe('player interno', () => {
  beforeEach(() => mockBridge({}))
  it('prefere o arquivo local e só abre a origem por ação explícita', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderWithApp(<MediaPreview item={{ ...item, filePath: 'C:/Legacy/video.mp4', videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }} onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Player de vídeo')).toHaveAttribute('src', 'legacy-media://file/C%3A%2FLegacy%2Fvideo.mp4')
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ver origem no Instagram' }))
    expect(open).toHaveBeenCalledWith(item.permalink, '_blank')
    open.mockRestore()
  })
  it('recusa uma URL fora dos CDNs e mantém a visualização no Legacy', async () => {
    renderWithApp(<MediaPreview item={{ ...item, videoUrl: 'https://localhost/video.mp4' }} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Player de vídeo')).not.toBeInTheDocument()
    expect(await screen.findByText(/Este post ainda não tem vídeo disponível/)).toBeInTheDocument()
  })
  it('mostra erro recuperável sem redirect quando a reprodução falha', async () => {
    renderWithApp(<MediaPreview item={{ ...item, videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }} onClose={vi.fn()} />)
    fireEvent.error(await screen.findByLabelText('Player de vídeo'))
    expect(await screen.findByText(/A URL pode ter expirado/)).toBeInTheDocument()
  })
})
