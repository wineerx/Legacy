import { expect, it, vi } from 'vitest'
import { createGuestSession } from './guest-session'

it('starts logged out on each process, pauses on exit and never exposes the token', () => {
  const pause = vi.fn()
  const session = createGuestSession(pause)
  expect(session.get()).toEqual({ entered: false, email: 'guest@legacy.com', mode: 'development' })
  expect(session.enter()).toEqual({ entered: true, email: 'guest@legacy.com', mode: 'development' })
  expect(pause).toHaveBeenLastCalledWith(false)
  expect(Object.keys(session.get())).toEqual(['entered', 'email', 'mode'])
  expect(session.exit().entered).toBe(false)
  expect(pause).toHaveBeenLastCalledWith(true)
  expect(createGuestSession(pause).get().entered).toBe(false)
})
