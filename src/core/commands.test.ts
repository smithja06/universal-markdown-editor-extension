import { expect, it, vi } from 'vitest'
import { CommandRegistry, fuzzyScore, matchesShortcut, shortcutLabel } from './commands'

it('registers, invokes and disposes host-independent commands', () => {
  const run = vi.fn()
  let available = false
  const registry = new CommandRegistry()
  const dispose = registry.register({ id: 'document.open', label: 'Open document', category: 'Document', available: () => available, run })
  expect(registry.execute('document.open', 'doc-b')).toBe(false)
  available = true
  expect(registry.execute('document.open', 'doc-b')).toBe(true)
  expect(run).toHaveBeenCalledExactlyOnceWith('doc-b')
  expect(() => registry.register({ id: 'document.open', label: 'Duplicate identifier', category: 'Document', run })).toThrow()
  dispose()
  expect(registry.list()).toEqual([])
})

it('ranks prefixes and finds subsequences and accented names', () => {
  expect(fuzzyScore('fnd rpl', 'Find and replace')).toBeGreaterThan(0)
  expect(fuzzyScore('find', 'Find and replace')).toBeGreaterThan(fuzzyScore('find', 'Open the find panel'))
  expect(fuzzyScore('resume', 'Résumé')).toBeGreaterThan(0)
  expect(fuzzyScore('xyz', 'Find and replace')).toBe(-1)
})

it('matches exact host modifiers and leaves sibling browser shortcuts alone', () => {
  const chord = { key: 'p', primary: true, shift: true }
  const press = { key: 'P', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }
  expect(matchesShortcut(chord, press, 'other')).toBe(true)
  expect(matchesShortcut(chord, { ...press, shiftKey: false }, 'other')).toBe(false)
  expect(matchesShortcut(chord, press, 'mac')).toBe(false)
  expect(matchesShortcut(chord, { ...press, ctrlKey: false, metaKey: true }, 'mac')).toBe(true)
  expect(shortcutLabel(chord, 'mac')).toBe('Cmd+Shift+P')
})
