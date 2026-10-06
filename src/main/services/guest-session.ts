import { randomBytes } from 'node:crypto'
import type { GuestSessionDto } from '@shared/ipc-contract'

/** Local development identity. Never used as an integration credential. */
export function createGuestSession(onPauseChanged: (paused: boolean) => void) {
  let developmentToken: string | null = null
  const get = (): GuestSessionDto => ({
    entered: developmentToken !== null,
    email: 'guest@legacy.com',
    mode: 'development'
  })
  return {
    get,
    enter: () => {
      developmentToken ??= `guest-development.${randomBytes(32).toString('base64url')}`
      onPauseChanged(false)
      return get()
    },
    exit: () => {
      developmentToken = null
      onPauseChanged(true)
      return get()
    }
  }
}
