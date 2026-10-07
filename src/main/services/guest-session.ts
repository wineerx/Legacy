import { randomBytes } from 'node:crypto'
import type { GuestSessionDto } from '@shared/ipc-contract'

/** Local development identity. Never used as an integration credential. */
export function createGuestSession(onPauseChanged: (paused: boolean) => void | Promise<void>) {
  let developmentToken: string | null = null
  let revision = 0
  const get = (): GuestSessionDto => ({
    entered: developmentToken !== null,
    email: 'guest@legacy.com',
    mode: 'development'
  })
  return {
    get,
    enter: async () => {
      const entering = ++revision
      await onPauseChanged(false)
      if (entering === revision) developmentToken ??= `guest-development.${randomBytes(32).toString('base64url')}`
      return get()
    },
    exit: async () => {
      revision++
      developmentToken = null
      await onPauseChanged(true)
      return get()
    }
  }
}
