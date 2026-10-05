import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MediaGrid } from './MediaGrid'
import { emptySelection } from '../lib/selection'

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
