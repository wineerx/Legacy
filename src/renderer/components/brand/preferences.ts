import { useSyncExternalStore } from 'react'
import type { MascotAccessory } from './LegacyMascot'

type Preferences = { accessory: MascotAccessory; motion: boolean }
const key = 'legacy.brand.v1'
const defaults: Preferences = { accessory: 'none', motion: true }
let cachedRaw: string | null | undefined
let cached: Preferences = defaults
const listeners = new Set<() => void>()
function snapshot(): Preferences {
  try {
    const raw = localStorage.getItem(key)
    if (raw === cachedRaw) return cached
    cachedRaw = raw
    const parsed = raw ? JSON.parse(raw) : defaults
    cached = { accessory: ['none', 'glasses', 'beanie', 'crown', 'party', 'bow'].includes(parsed?.accessory) ? parsed.accessory : 'none', motion: parsed?.motion !== false }
  } catch { cached = defaults }
  return cached
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener) }
}
export function useBrandPreferences() { return useSyncExternalStore(subscribe, snapshot, () => defaults) }
export function setBrandPreferences(patch: Partial<Preferences>) {
  const next = { ...snapshot(), ...patch }
  try { localStorage.setItem(key, JSON.stringify(next)); cachedRaw = JSON.stringify(next) } catch { /* Keep the preference for this session when storage is unavailable. */ }
  cached = next
  listeners.forEach(listener => listener())
}
