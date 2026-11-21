import { expect, it } from 'vitest'
import { isClientMessage, isHostMessage, rebaseSource, sourceChange, spliceSource } from './protocol'

it('validates message directions and requires safe revisions and normalized LF source', () => {
  const state = { uri: 'file:///notes.md', title: 'notes.md', source: 'one\ntwo', revision: 2, dirty: true, available: true, eol: '\r\n' }
  expect(isHostMessage({ type: 'state', state, edit: { id: 1, accepted: false, message: 'Changed externally.' } })).toBe(true)
  expect(isHostMessage({ type: 'state', state: { ...state, source: 'one\r\ntwo' } })).toBe(false)
  expect(isHostMessage({ type: 'state', state: { ...state, uri: '' } })).toBe(false)
  expect(isHostMessage({ type: 'state', state: { ...state, revision: 1.4 } })).toBe(false)
  expect(isHostMessage({ type: 'ready' })).toBe(false)
  expect(isClientMessage({ type: 'ready' })).toBe(true)
  expect(isClientMessage({ type: 'command', command: 'copy', text: 'note' })).toBe(true)
  expect(isClientMessage({ type: 'command', command: 'copy' })).toBe(false)
  expect(isClientMessage({ type: 'command', command: 'open' })).toBe(false)
  expect(isClientMessage({ type: 'edit', id: 1, revision: 2, change: { from: 4, to: 3, text: 'text' } })).toBe(false)
  expect(isClientMessage({ type: 'edit', id: 1, revision: 2, change: { from: 2, to: Infinity, text: 'text' } })).toBe(false)
})

it('creates minimal changes in UTF-16 without splitting emoji', () => {
  const before = 'A😀B'
  const after = 'A😃B'
  const edit = sourceChange(before, after)
  expect(edit).toEqual({ from: 1, to: 3, text: '😃' })
  expect(edit && spliceSource(before, edit)).toBe(after)
  expect(sourceChange(before, before)).toBeUndefined()
  expect(() => spliceSource(before, { from: 0, to: 9, text: '' })).toThrow(RangeError)
})

it('merges disjoint edits in either order and refuses concurrent edits to the same text', () => {
  expect(rebaseSource('alpha middle omega', 'ALPHABET middle omega', 'alpha middle Ω')).toBe('ALPHABET middle Ω')
  expect(rebaseSource('alpha middle omega', 'alpha middle Ω', 'ALPHABET middle omega')).toBe('ALPHABET middle Ω')
  expect(rebaseSource('middle', 'Left middle', 'Right middle')).toBeUndefined()
  expect(rebaseSource('middle', 'New middle', 'New middle')).toBe('New middle')
})
