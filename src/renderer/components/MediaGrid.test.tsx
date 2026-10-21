import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { MediaGrid } from './MediaGrid'
import { emptySelection, toggleId } from '../lib/selection'
import type { GridItem } from '@shared/types'

let trigger: ((entries: { isIntersecting: boolean }[]) => void) | null = null

beforeEach(() => {
  trigger = null
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { trigger = cb }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

const base = { items: [], selection: emptySelection(), onToggleSelect: vi.fn() }

describe('MediaGrid', () => {
  it('Ctrl + clique acumula e remove vídeos sem abrir o player nem interferir nas ações', async () => {
    const onOpen = vi.fn(), action = vi.fn()
    const items: GridItem[] = ['primeiro', 'segundo'].map(id => ({ id, kind: 'remote', caption: id, thumbnailPath: null, permalink: null, postedAt: null, durationMs: null, metrics: { views: null, likes: null, comments: null }, badges: [] }))
    function Grid() {
      const [selection, setSelection] = useState(emptySelection)
      return <MediaGrid items={items} loading={false} selection={selection} onToggleSelect={id => setSelection(previous => toggleId(previous, id))} onOpen={onOpen} renderActions={item => <button onClick={action}>Ação {item.id}</button>} />
    }
    render(<Grid />)
    const user = userEvent.setup()
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('button', { name: 'Abrir primeiro' }))
    await user.click(screen.getByRole('button', { name: 'Abrir segundo' }))
    expect(screen.getByRole('checkbox', { name: 'Selecionar primeiro' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Selecionar segundo' })).toBeChecked()
    expect(onOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Abrir primeiro' }))
    expect(screen.getByRole('checkbox', { name: 'Selecionar primeiro' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Selecionar segundo' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Ação primeiro' }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('checkbox', { name: 'Selecionar primeiro' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar primeiro' }))
    expect(screen.getByRole('checkbox', { name: 'Selecionar primeiro' })).toBeChecked()
    await user.keyboard('{/Control}')
    await user.click(screen.getByRole('button', { name: 'Abrir primeiro' }))
    expect(onOpen).toHaveBeenCalledWith(items[0])
  })
  it('chama onEndReached quando o sentinela aparece e não está carregando', () => {
    const onEnd = vi.fn()
    render(<MediaGrid {...base} loading={false} onEndReached={onEnd} />)
    trigger!([{ isIntersecting: true }])
    expect(onEnd).toHaveBeenCalledTimes(1)
  })
  it('não chama onEndReached enquanto carrega', () => {
    const onEnd = vi.fn()
    render(<MediaGrid {...base} loading onEndReached={onEnd} />)
    trigger!([{ isIntersecting: true }])
    expect(onEnd).not.toHaveBeenCalled()
  })
  it('mostra 10 skeletons ao carregar', () => {
    const { container } = render(<MediaGrid {...base} loading />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(10)
  })
})
