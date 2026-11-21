import { expect, it } from 'vitest'
import { createLiveDocumentClient } from './liveDocument'
import type { ClientMessage, DocumentState, HostMessage } from './protocol'

const base: DocumentState = {
  uri: 'file:///notes.md', title: 'notes.md', source: 'alpha\nmiddle\nomega',
  revision: 1, dirty: false, eol: '\n', available: true,
}

function connection() {
  const sent: ClientMessage[] = []
  let listener: ((message: unknown) => void) | undefined
  const client = createLiveDocumentClient({
    post(message) { sent.push(message) },
    listen(handle) { listener = handle; return () => { listener = undefined } },
  })
  const receive = (message: HostMessage) => listener?.(message)
  const state = (value: Partial<DocumentState> = {}, edit?: { id: number; accepted: boolean; message?: string }) => receive({ type: 'state', state: { ...base, ...value }, edit })
  return { client, sent, receive, state }
}

it('waits for the host document before sending any content and disposes the message listener', () => {
  const { client, sent, state } = connection()
  const seen: string[] = []
  const unsubscribe = client.subscribe(value => seen.push(value.source))
  expect(client.read()).toMatchObject({ id: '', pending: true, available: false })
  client.edit('premature')
  expect(sent).toEqual([{ type: 'ready' }])
  state({ title: 'Native title', eol: '\r\n' })
  expect(client.read()).toMatchObject({ id: base.uri, title: 'Native title', source: base.source, lineEnding: '\r\n', pending: false, available: true })
  unsubscribe()
  state({ revision: 2, source: 'new native text' })
  client.dispose()
  state({ revision: 3, source: 'ignored after disposal' })
  client.edit('ignored after disposal')
  expect(seen).toEqual([base.source])
  expect(client.read().source).toBe('new native text')
  expect(sent).toHaveLength(1)
})

it('serializes optimistic changes and sends queued native commands after the latest acknowledgement', () => {
  const { client, sent, state } = connection()
  state()
  client.edit('alpha\nmiddle\nomega!')
  client.edit('alpha\nmiddle\nomega!?')
  client.run('save')
  client.run('undo')
  expect(sent.slice(1)).toEqual([{ type: 'edit', id: 1, revision: 1, change: { from: 18, to: 18, text: '!' } }])
  expect(client.read()).toMatchObject({ source: 'alpha\nmiddle\nomega!?', dirty: true, pending: true })
  state({ revision: 2, source: 'alpha\nmiddle\nomega!', dirty: true }, { id: 1, accepted: true })
  expect(sent[2]).toEqual({ type: 'edit', id: 2, revision: 2, change: { from: 19, to: 19, text: '?' } })
  state({ revision: 3, source: 'alpha\nmiddle\nomega!?', dirty: true }, { id: 2, accepted: true })
  expect(sent.slice(3)).toEqual([{ type: 'command', command: 'save' }, { type: 'command', command: 'undo' }])
  expect(client.read()).toMatchObject({ source: 'alpha\nmiddle\nomega!?', dirty: true, pending: false })
  state({ revision: 3, source: 'alpha\nmiddle\nomega!?', dirty: false })
  expect(client.read().dirty).toBe(false)
})

it('retries a stale proposal against a newer disjoint native edit', () => {
  const { client, sent, state } = connection()
  state()
  client.edit('ALPHABET\nmiddle\nomega')
  state({ revision: 2, source: 'alpha\nmiddle\nΩ', dirty: true })
  state({ revision: 2, source: 'alpha\nmiddle\nΩ', dirty: true }, { id: 1, accepted: false, message: 'Stale revision.' })
  expect(sent.at(-1)).toEqual({ type: 'edit', id: 2, revision: 2, change: { from: 0, to: 5, text: 'ALPHABET' } })
  expect(client.read()).toMatchObject({ source: 'ALPHABET\nmiddle\nΩ', dirty: true, pending: true })
  state({ revision: 3, source: 'ALPHABET\nmiddle\nΩ', dirty: true }, { id: 2, accepted: true })
  expect(client.read().pending).toBe(false)
})

it('rebases unsent input when a newer native snapshot arrives before an earlier accepted acknowledgement', () => {
  const { client, sent, state } = connection()
  state()
  client.edit('ALPHABET\nmiddle\nomega')
  client.edit('ALPHABET\nCENTER\nomega')
  state({ revision: 3, source: 'ALPHABET\nmiddle\nΩ', dirty: true })
  state({ revision: 2, source: 'ALPHABET\nmiddle\nomega', dirty: true }, { id: 1, accepted: true })
  expect(sent.at(-1)).toEqual({ type: 'edit', id: 2, revision: 3, change: { from: 9, to: 15, text: 'CENTER' } })
  expect(client.read().source).toBe('ALPHABET\nCENTER\nΩ')
})

it('recovers the complete optimistic draft on overlap and requires an explicit discard before editing', () => {
  const { client, sent, state } = connection()
  state()
  const draft = 'Updated in Folio\nmiddle\nomega'
  const native = 'Updated in VS Code\nmiddle\nomega'
  client.edit(draft)
  client.run('save')
  state({ revision: 2, source: native, dirty: true }, { id: 1, accepted: false })
  expect(client.read()).toMatchObject({ source: native, conflict: draft, pending: false, available: true })
  client.edit('attempt during conflict')
  client.run('undo')
  expect(sent).toHaveLength(2)
  client.discardConflict()
  expect(client.read().conflict).toBeUndefined()
  client.edit(native + '!')
  expect(sent.at(-1)).toMatchObject({ type: 'edit', id: 2, revision: 2 })
})

it('does not repeatedly retry an edit rejected at the current native revision', () => {
  const { client, sent, state } = connection()
  state()
  client.edit('My notes')
  state({}, { id: 1, accepted: false, message: 'Edit denied.' })
  expect(client.read()).toMatchObject({ source: base.source, conflict: 'My notes', message: 'Edit denied.', pending: false })
  expect(sent).toHaveLength(2)
})

it('ignores stale and foreign snapshots and never reopens a confirmed unavailable URI', () => {
  const { client, sent, state } = connection()
  state({ revision: 2 })
  client.edit(base.source + ' (Folio)')
  state({ uri: 'file:///renamed.md', revision: 5, source: 'different book' }, { id: 1, accepted: true })
  state({ revision: 1, source: 'old' })
  expect(client.read()).toMatchObject({ id: base.uri, source: base.source + ' (Folio)', pending: true, available: true })
  state({ revision: 2, available: false })
  expect(client.read()).toMatchObject({ id: base.uri, source: base.source, conflict: base.source + ' (Folio)', pending: false, available: false })
  client.discardConflict()
  state({ revision: 3, source: 'late response' }, { id: 1, accepted: true })
  client.edit('blocked')
  client.run('save')
  expect(client.read()).toMatchObject({ source: base.source, available: false })
  expect(client.read().conflict).toBeUndefined()
  expect(sent).toHaveLength(2)
})
