import { expect, it } from 'vitest'
import { connectionMessage, isClientMessage, isHostMessage, rebaseSource, sourceChange, spliceSource } from './protocol'

it('accepts only listed editor actions and bounded resource request shapes', () => {
  expect(isHostMessage({ type: 'action', action: 'view.mode.split' })).toBe(true)
  expect(isHostMessage({ type: 'action', action: 'workbench.action.closeWindow' })).toBe(false)
  expect(isClientMessage({ type: 'resource', operation: 'open', id: 1, reference: './notes.md#heading' })).toBe(true)
  expect(isClientMessage({ type: 'resource', operation: 'read', id: 1, reference: './notes.md' })).toBe(false)
  expect(isClientMessage({ type: 'resource', operation: 'image', id: 1, reference: 'a'.repeat(4097) })).toBe(false)
  expect(isHostMessage({ type: 'resourceResult', id: 1, ok: true, image: 'http://example.org/asset.png' })).toBe(false)
  expect(isHostMessage({ type: 'resourceResult', id: 1, ok: true, image: 'data:image/svg+xml;base64,AAAA' })).toBe(false)
})

it('validates message directions and requires safe revisions and normalized LF source', () => {
  const state = { uri: 'file:///notes.md', title: 'notes.md', source: 'one\ntwo', revision: 2, dirty: true, available: true, eol: '\r\n' }
  expect(isHostMessage({ type: 'state', state, edit: { id: 1, accepted: false, message: 'Changed externally.' } })).toBe(true)
  expect(isHostMessage({ type: 'state', state: { ...state, source: 'one\r\ntwo' } })).toBe(false)
  expect(isHostMessage({ type: 'state', state: { ...state, uri: '' } })).toBe(false)
  expect(isHostMessage({ type: 'state', state: { ...state, revision: 1.4 } })).toBe(false)
  expect(isHostMessage({ type: 'ready' })).toBe(false)
  expect(isClientMessage({ type: 'ready' })).toBe(true)
  expect(isClientMessage({ type: 'copy', id: 1, text: 'note' })).toBe(true)
  expect(isClientMessage({ type: 'copy', id: 1 })).toBe(false)
  expect(isClientMessage({ type: 'command', command: 'open' })).toBe(false)
  expect(isClientMessage({ type: 'edit', id: 1, revision: 2, change: { from: 4, to: 3, text: 'text' } })).toBe(false)
  expect(isClientMessage({ type: 'edit', id: 1, revision: 2, change: { from: 2, to: Infinity, text: 'text' } })).toBe(false)
})

it('accepts a source-free acknowledgement only with valid document metadata and an edit ID', () => {
  const state = { uri: 'file:///notes.md', title: 'notes.md', revision: 2, dirty: true, available: true, eol: '\r\n' }
  const reply = { type: 'accepted', state, edit: { id: 1 } }
  expect(isHostMessage(reply)).toBe(true)
  expect(isHostMessage({ ...reply, edit: { id: 0 } })).toBe(false)
  expect(isHostMessage({ ...reply, state: { ...state, available: false } })).toBe(false)
  expect(isHostMessage({ ...reply, state: { ...state, source: 'different text' } })).toBe(false)
  expect(isHostMessage({ ...reply, type: 'state' })).toBe(false)
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

it('validates the connection and recovery journal payloads in both directions', () => {
  const id = '15b2df20-4d71-4cfa-a87d-f69dc49dd751'
  const scope = 'a'.repeat(64)
  const draft = { id, uri: 'file:///note.md', generation: 2, reason: 'conflict', source: 'draft', eol: '\r\n', bom: true,
    native: { source: 'native\n', eol: '\n', bom: false } }
  const message = { type: 'checkpoint', draft }
  expect(connectionMessage({ connection: id, message }, isClientMessage)).toEqual({ connection: id, message })
  expect(connectionMessage({ connection: '../note.md', message }, isClientMessage)).toBeUndefined()
  expect(isClientMessage({ ...message, draft: { ...draft, generation: 0 } })).toBe(false)
  expect(isClientMessage({ ...message, draft: { ...draft, native: { ...draft.native, source: 'bad\r' } } })).toBe(false)
  expect(isClientMessage({ type: 'dismiss', id, generation: Infinity })).toBe(false)
  expect(isHostMessage({ type: 'recovery', id, scope, active: [id], drafts: [draft] })).toBe(true)
  expect(isHostMessage({ type: 'recovery', id, scope: '', active: [id], drafts: [draft] })).toBe(false)
})
