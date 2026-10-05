import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { mockBridge, renderWithApp } from '../../test-utils'
import { OverviewPage } from './OverviewPage'

describe('OverviewPage', () => {
  it('mostra passos e motivo de indisponível', async () => {
    mockBridge({
      'onboarding.status': () => [
        { key: 'workspace', label: 'Criar workspace', done: true },
        { key: 'connect_instagram', label: 'Conectar Instagram', done: false, disabledReason: 'Disponível na próxima versão (conexão oficial com o Instagram).' },
        { key: 'import_videos', label: 'Importar 3 vídeos', done: false }
      ]
    })
    renderWithApp(<OverviewPage navigate={vi.fn()} />)
    expect(await screen.findByText('Criar workspace')).toBeInTheDocument()
    expect(screen.getByText('Disponível na próxima versão (conexão oficial com o Instagram).')).toBeInTheDocument()
    expect(screen.getByText('1 de 3 concluídos')).toBeInTheDocument()
  })
})
