import { expect, it, vi } from 'vitest'
import { createGuestSession } from './guest-session'

it('starts logged out on each process, pauses on exit and never exposes the token', async () => {
  const pause = vi.fn()
  const session = createGuestSession(pause)
  expect(session.get()).toEqual({ entered: false, email: 'guest@legacy.com', mode: 'development' })
  expect(await session.enter()).toEqual({ entered: true, email: 'guest@legacy.com', mode: 'development' })
  expect(pause).toHaveBeenLastCalledWith(false)
  expect(Object.keys(session.get())).toEqual(['entered', 'email', 'mode'])
  expect((await session.exit()).entered).toBe(false)
  expect(pause).toHaveBeenLastCalledWith(true)
  expect(createGuestSession(pause).get().entered).toBe(false)
})


it('waits for the pause acknowledgement and a late entry cannot undo exit', async () => {
  let resumed!: () => void
  let paused!: () => void
  const session = createGuestSession(value => new Promise<void>(resolve => {
    if (value) paused = resolve
    else resumed = resolve
  }))
  const entering = session.enter()
  expect(session.get().entered).toBe(false)
  const exiting = session.exit()
  let finished = false
  void exiting.then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  paused()
  await exiting
  resumed()
  expect((await entering).entered).toBe(false)
})
