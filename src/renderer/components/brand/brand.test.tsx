import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JobView } from '@shared/types'
import { BrandPanel } from './BrandPanel'
import { LegacyMascot } from './LegacyMascot'
import { resolveMascotState, processorSignal, isRateLimit, dominantSignal } from './status'

const job = (state: JobView['state'], type: JobView['type'] = 'download_reel') => ({ state, type, runAt: new Date(0).toISOString(), label: 'Vídeo', lastError: null }) as JobView

describe('Legacy — estado e personalização', () => {
  beforeEach(() => localStorage.clear())

  it('prioriza indisponibilidade e tarefas em execução sem tratar histórico como conclusão atual', () => {
    expect(resolveMascotState(false, [job('running')])).toBe('error')
    expect(resolveMascotState(true, [], true)).toBe('error')
    expect(resolveMascotState(true, undefined)).toBe('thinking')
    expect(resolveMascotState(true, [job('failed'), job('running')])).toBe('error')
    expect(resolveMascotState(true, [job('running', 'publish_instagram')])).toBe('publishing')
    expect(resolveMascotState(true, [job('running', 'fetch_profile')])).toBe('searching')
    expect(resolveMascotState(true, [job('queued')])).toBe('waiting')
    expect(resolveMascotState(true, [job('failed')])).toBe('error')
    expect(resolveMascotState(true, [job('done')])).toBe('idle')
  })

  it('altera a prévia e aplica a preferência de movimento a outros mascotes', async () => {
    render(<><BrandPanel /><LegacyMascot state="working" /></>)
    await userEvent.click(screen.getByRole('button', { name: 'Buscando' }))
    expect(screen.getByRole('img', { name: 'Legacy: Buscando' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Visual: Coroa' }))
    expect(screen.getByRole('button', { name: 'Visual: Coroa' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('switch', { name: 'Animações do mascote' }))
    expect(screen.getByRole('img', { name: 'Legacy: Trabalhando' })).toHaveAttribute('data-animated', 'false')
    expect(JSON.parse(localStorage.getItem('legacy.brand.v1')!)).toEqual({ accessory: 'crown', motion: false })
  })

  it('mantém agendamentos futuros em repouso e diferencia retry de limite real', () => {
    const scheduled = { ...job('queued'), runAt: new Date(Date.now() + 60000).toISOString() }
    expect(processorSignal(true, [scheduled]).state).toBe('idle')
    expect(processorSignal(true, [{ ...scheduled, lastError: 'HTTP 429' }]).state).toBe('rate_limit')
    expect(processorSignal(true, [{ ...scheduled, lastError: 'HTTP 429' }]).message).toContain('Próxima tentativa às')
    expect(processorSignal(true, [{ ...job('failed'), lastError: 'HTTP 429' }]).message).not.toContain('Próxima tentativa')
    expect(isRateLimit('Confira token, permissões e limite de publicação.')).toBe(false)
    expect(dominantSignal([{ state: 'working', message: '' }, { state: 'approval', message: '' }]).state).toBe('approval')
  })

  it('recupera preferências inválidas e usa IDs SVG únicos', () => {
    localStorage.setItem('legacy.brand.v1', '{broken')
    const { container } = render(<><LegacyMascot /><LegacyMascot /></>)
    const ids = [...container.querySelectorAll('[id]')].map(element => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(screen.getAllByRole('img', { name: 'Legacy: Em repouso' })[0]).toHaveAttribute('data-animated', 'true')
  })
})
