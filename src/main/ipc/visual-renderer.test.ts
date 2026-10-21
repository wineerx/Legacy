import { expect, it, vi } from 'vitest'
import { blankLayout } from '@shared/visual-layout'
import type { VisualRaster } from '@shared/visual-raster'
import { createVisualRenderer, type VisualRendererHost } from './visual-renderer'

const raster: VisualRaster = { background: 'data:image/png;base64,', layers: [] }
function fakeHosts(behaviours: ((gone: (reason: string) => void) => Partial<VisualRendererHost>)[]) {
  const created: { destroyed: boolean }[] = []
  const createHost = () => {
    const state = { destroyed: false }; created.push(state)
    let gone: (reason: string) => void = () => {}
    const custom = behaviours[created.length - 1]?.(reason => gone(reason)) ?? {}
    return { load: async () => {}, run: async () => raster, ...custom, onGone: cb => { gone = cb }, destroy: () => { state.destroyed = true } } satisfies VisualRendererHost
  }
  return { createHost, created }
}

it('times out a hung render, discards that window and recovers with a fresh one', async () => {
  vi.useFakeTimers()
  try {
    const { createHost, created } = fakeHosts([() => ({ run: () => new Promise(() => {}) })])
    const renderer = createVisualRenderer({ createHost, timeoutMs: 1000 })
    const hung = renderer.render(blankLayout()), next = renderer.render(blankLayout())
    const failed = expect(hung).rejects.toThrow(/Tempo excedido/)
    await vi.advanceTimersByTimeAsync(1000)
    await failed
    await expect(next).resolves.toEqual(raster)
    expect(created).toEqual([{ destroyed: true }, { destroyed: false }])
  } finally { vi.useRealTimers() }
})

it('a renderer crash rejects the pending request; later requests use a new window', async () => {
  const { createHost, created } = fakeHosts([gone => ({ run: () => { setTimeout(() => gone('crashed')); return new Promise(() => {}) } })])
  const renderer = createVisualRenderer({ createHost, timeoutMs: 10_000 })
  await expect(renderer.render(blankLayout())).rejects.toThrow(/encerrado \(crashed\)/)
  await expect(renderer.render(blankLayout())).resolves.toEqual(raster)
  expect(created.map(c => c.destroyed)).toEqual([true, false])
})

it('a failed page load is not cached and the next request reloads', async () => {
  const { createHost, created } = fakeHosts([() => ({ load: async () => { throw new Error('load failed') } })])
  const renderer = createVisualRenderer({ createHost })
  await expect(renderer.render(blankLayout())).rejects.toThrow(/load failed/)
  await expect(renderer.render(blankLayout())).resolves.toEqual(raster)
  expect(created).toHaveLength(2)
})

it('validates the layout before reaching the window and rejects everything after dispose', async () => {
  const { createHost, created } = fakeHosts([() => ({ run: () => new Promise(() => {}) })])
  const renderer = createVisualRenderer({ createHost })
  await expect(renderer.render({ ...blankLayout(), width: 1081 })).rejects.toThrow()
  expect(created).toHaveLength(0)
  const pending = renderer.render(blankLayout())
  await vi.waitFor(() => expect(created).toHaveLength(1))
  renderer.dispose()
  await expect(pending).rejects.toThrow(/encerrado/)
  await expect(renderer.render(blankLayout())).rejects.toThrow(/encerrado/)
  expect(created[0].destroyed).toBe(true)
})
