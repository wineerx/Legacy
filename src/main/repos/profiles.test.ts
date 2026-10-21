import { expect, it } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from './workspaces'
import { addProfileFromUrl, archiveProfile, getProfile, listProfiles } from './profiles'

it('arquiva por workspace, preserva o perfil e restaura sem duplicar ao importar novamente', () => {
  const db = memDb()
  const ws = createWorkspace(db, { name: 'A', timeZone: 'UTC' }).id
  const other = createWorkspace(db, { name: 'B', timeZone: 'UTC' }).id
  const ctx = { db, dataRoot: '.', clock: () => new Date() }
  const p = addProfileFromUrl(ctx, ws, '@example')
  expect(() => archiveProfile(ctx, other, p.id, true)).toThrow('Perfil não encontrado.')
  archiveProfile(ctx, ws, p.id, true)
  expect(listProfiles(db, ws)).toEqual([])
  expect(listProfiles(db, ws, true).map(p => p.id)).toEqual([p.id])
  expect(getProfile(db, ws, p.id)).not.toBeNull()
  archiveProfile(ctx, ws, p.id, false)
  expect(listProfiles(db, ws).map(p => p.id)).toEqual([p.id])
  archiveProfile(ctx, ws, p.id, true)
  expect(addProfileFromUrl(ctx, ws, '@example').id).toBe(p.id)
  expect(listProfiles(db, ws)).toHaveLength(1)
  expect(listProfiles(db, ws, true)).toEqual([])
})
