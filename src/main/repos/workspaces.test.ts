import { describe, it, expect } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace, listWorkspaces, getWorkspace, ensureDefaultWorkspace } from './workspaces'
import { getSetting, setSetting } from './settings'
import { AppError } from '@shared/errors'

describe('workspaces', () => {
  it('cria e lista', () => {
    const db = memDb()
    const ws = createWorkspace(db, { name: 'Marca A', timeZone: 'America/Sao_Paulo' })
    expect(listWorkspaces(db).map((w) => w.id)).toEqual([ws.id])
    expect(getWorkspace(db, ws.id)?.name).toBe('Marca A')
  })
  it('rejeita fuso inválido', () => {
    expect(() => createWorkspace(memDb(), { name: 'X', timeZone: 'Marte/Base' })).toThrow(AppError)
  })
  it('rejeita nome vazio', () => {
    expect(() => createWorkspace(memDb(), { name: '  ', timeZone: 'UTC' })).toThrow(AppError)
  })
  it('ensureDefaultWorkspace é idempotente', () => {
    const db = memDb()
    const a = ensureDefaultWorkspace(db, 'America/Sao_Paulo')
    const b = ensureDefaultWorkspace(db, 'America/Sao_Paulo')
    expect(a.id).toBe(b.id)
    expect(a.name).toBe('Meu workspace')
  })
})

describe('settings', () => {
  it('isola por workspace', () => {
    const db = memDb()
    const a = createWorkspace(db, { name: 'A', timeZone: 'UTC' })
    const b = createWorkspace(db, { name: 'B', timeZone: 'UTC' })
    setSetting(db, a.id, 'minimizeToTray', 'true')
    expect(getSetting(db, a.id, 'minimizeToTray')).toBe('true')
    expect(getSetting(db, b.id, 'minimizeToTray')).toBeNull()
    setSetting(db, a.id, 'minimizeToTray', 'false')
    expect(getSetting(db, a.id, 'minimizeToTray')).toBe('false')
  })
})
