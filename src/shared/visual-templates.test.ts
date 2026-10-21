import { expect, it } from 'vitest'
import { contract } from './ipc-contract'
import { containerVisualSnapshot } from './container-visual'

export const scene = { width: 1080, height: 1920, background: '#ffffff', margin: 32, elements: [
  { id: 'media', type: 'media', x: 32, y: 420, width: 1016, height: 1100, opacity: 100, radius: 24, borderWidth: 0, borderColor: '#000000', visible: true, fit: 'contain', alignX: 50, alignY: 50 },
  { id: 'title', type: 'text', x: 32, y: 100, width: 1016, height: 280, opacity: 100, radius: 0, borderWidth: 0, borderColor: '#000000', visible: true, text: '{{custom_text}}', font: 'Inter', weight: 700, fontSize: 48, lineHeight: 1.2, color: '#000000', align: 'center', padding: 8 }
] }
it('accepts a composition snapshot independently of a template record', () => {
  expect(containerVisualSnapshot.safeParse({ version: 2, layout: scene, context: { custom_text: 'Olá' } }).success).toBe(true)
})
it('exposes versioned visual template CRUD and application contracts', () => {
  for (const name of ['templates.create', 'templates.saveVersion', 'templates.get', 'templates.query', 'templates.duplicate', 'templates.archive', 'templates.delete', 'containers.applyTemplate']) expect(Object.keys(contract)).toContain(name)
})
