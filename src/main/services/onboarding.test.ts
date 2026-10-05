import { describe, it, expect } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { onboardingStatus } from './onboarding'

describe('onboardingStatus', () => {
  it('estado inicial', () => {
    const db = memDb()
    const ws = createWorkspace(db, { name: 'A', timeZone: 'UTC' }).id
    const steps = onboardingStatus(db, ws)
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ['workspace', true], ['connect_instagram', false], ['import_videos', false], ['cover', false], ['first_batch', false]
    ])
    expect(steps[1].disabledReason).toBe('Configure a conta profissional por token em Contas.')
  })
})
