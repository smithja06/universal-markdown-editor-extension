import { afterEach, expect, it, vi } from 'vitest'
import { createLiveDocumentClient } from './liveDocument'
import type { ClientMessage, DocumentState, HostMessage } from './protocol'
import { createRecoveryJournal, type RecoveryJournal } from './recovery'

const base: DocumentState = {
  uri: 'file:///notes.md', title: 'notes.md', source: 'alpha\nmiddle\nomega',
  revision: 1, dirty: false, eol: '\n', available: true,
}

const scope = 'a'.repeat(64)
const journalId = '15b2df20-4d71-4cfa-a87d-f69dc49dd751'
const reopenedId = '28fbba20-1e91-4c18-8f94-65bbc914c320'

afterEach(() => localStorage.clear())

function connection(journal?: RecoveryJournal, id = journalId) {
  const sent: ClientMessage[] = []
  let listener: ((message: HostMessage) => void) | undefined
  const client = createLiveDocumentClient({
    post(message) { sent.push(message) },
    listen(handle) { listener = handle; return () => { listener = undefined } },
  }, journal)
  const receive = (message: HostMessage) => listener?.(message)
  const state = (value: Partial<DocumentState> = {}, edit?: { id: number; accepted: boolean; message?: string }) => receive({ type: 'state', state: { ...base, ...value }, edit })
  const recover = () => receive({ type: 'recovery', scope, id, active: [id], drafts: [] })
  const discard = () => {
    const draft = client.read().recovery?.[0]
    if (!draft) throw new Error('Expected a recovery draft.')
    client.discardRecovery(draft.id)
    receive({ type: 'dismissed', id: draft.id, generation: draft.generation, dismissed: true })
  }
  return { client, sent, receive, state, recover, discard }
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

it('uses only the matching proposal for source-free acknowledgements during a large typing burst', () => {
  const { client, sent, state, receive, recover } = connection(createRecoveryJournal(() => localStorage))
  const large = 'Markdown with **formatting**.\n\n'.repeat(17_000)
  const first = large + 'a'
  const suffix = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2)
  const { uri, title, eol, available } = base
  recover()
  state({ source: large })
  for (let i = 1; i <= suffix.length; i++) client.edit(large + suffix.slice(0, i))
  expect(sent.filter(message => message.type === 'edit')).toHaveLength(1)
  const ack = (id: number, revision: number) => receive({ type: 'accepted', state: { uri, title, eol, available, revision, dirty: true }, edit: { id } })
  ack(2, 2)
  ack(1, 1)
  expect(client.read().pending).toBe(true)
  expect(createRecoveryJournal(() => localStorage).read(scope).map(item => item.source)).toEqual([large + suffix])
  ack(1, 2)
  expect(sent.at(-1)).toMatchObject({ type: 'edit', id: 2, revision: 2, change: { from: first.length, to: first.length, text: suffix.slice(1) } })
  ack(1, 4)
  expect(client.read().pending).toBe(true)
  expect(createRecoveryJournal(() => localStorage).read(scope)[0]?.source).toBe(large + suffix)
  ack(2, 3)
  expect(client.read()).toMatchObject({ source: large + suffix, dirty: true, pending: false })
  expect(createRecoveryJournal(() => localStorage).read(scope)).toEqual([])
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

it('keeps both rich snapshots when disjoint DOCX wire edits race', () => {
  const { client, state, receive, sent } = connection(createRecoveryJournal(() => localStorage))
  const uri = 'file:///notes.docx'
  const docx = (left: string, right: string) => JSON.stringify({ type: 'doc', content: [left, right].map(text =>
    ({ type: 'paragraph', content: [{ type: 'text', text }] })) })
  const native = docx('left', 'right native')
  const draft = docx('left Folio', 'right')
  receive({ type: 'recovery', scope, id: journalId, active: [journalId], drafts: [] })
  state({ uri, format: 'docx', source: docx('left', 'right') })
  client.edit(draft)
  state({ uri, format: 'docx', source: native, revision: 2 }, { id: 1, accepted: false })
  expect(client.read()).toMatchObject({ source: native, conflict: draft, pending: false })
  expect(client.read().recovery?.[0]).toMatchObject({ reason: 'conflict', source: draft, native: { source: native } })
  expect(sent.filter(message => message.type === 'edit')).toHaveLength(1)
  client.dispose()
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

it('keeps the deferred native snapshot and the full overlapping draft after a source-free acknowledgement', () => {
  const { client, state, receive, recover } = connection(createRecoveryJournal(() => localStorage))
  const { uri, title, eol, available } = base
  recover()
  state()
  client.edit('ALPHA\nmiddle\nomega')
  const draft = 'ALPHA\nFolio middle\nomega'
  const native = 'ALPHA\nNative middle\nomega'
  client.edit(draft)
  state({ revision: 3, source: native, dirty: true })
  receive({ type: 'accepted', state: { uri, title, eol, available, revision: 2, dirty: true }, edit: { id: 1 } })
  expect(client.read()).toMatchObject({ source: native, conflict: draft })
  expect(createRecoveryJournal(() => localStorage).read(scope)).toMatchObject([{ source: draft, reason: 'conflict', native: { source: native } }])
})

it('recovers the complete optimistic draft on overlap and requires an explicit discard before editing', () => {
  const { client, sent, state, recover, discard } = connection(createRecoveryJournal(() => localStorage))
  recover()
  state()
  const draft = 'Updated in Folio\nmiddle\nomega'
  const native = 'Updated in VS Code\nmiddle\nomega'
  client.edit(draft)
  client.run('save')
  state({ revision: 2, source: native, dirty: true }, { id: 1, accepted: false })
  expect(client.read()).toMatchObject({ source: native, conflict: draft, pending: false, available: true })
  client.edit('attempt during conflict')
  client.run('undo')
  expect(sent.filter(message => message.type === 'edit' || message.type === 'command')).toHaveLength(1)
  discard()
  expect(client.read().conflict).toBeUndefined()
  client.edit(native + '!')
  expect(sent.at(-1)).toMatchObject({ type: 'edit', id: 2, revision: 2 })
  client.dispose()
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
  const { client, sent, state, recover, discard } = connection(createRecoveryJournal(() => localStorage))
  recover()
  state({ revision: 2 })
  client.edit(base.source + ' (Folio)')
  state({ uri: 'file:///renamed.md', revision: 5, source: 'different book' }, { id: 1, accepted: true })
  state({ revision: 1, source: 'old' })
  expect(client.read()).toMatchObject({ id: base.uri, source: base.source + ' (Folio)', pending: true, available: true })
  state({ revision: 2, available: false })
  expect(client.read()).toMatchObject({ id: base.uri, source: base.source, conflict: base.source + ' (Folio)', pending: false, available: false })
  discard()
  state({ revision: 3, source: 'late response' }, { id: 1, accepted: true })
  client.edit('blocked')
  client.run('save')
  expect(client.read()).toMatchObject({ source: base.source, available: false })
  expect(client.read().conflict).toBeUndefined()
  expect(sent.filter(message => message.type === 'edit' || message.type === 'command')).toHaveLength(1)
  client.dispose()
})

it('preserves the latest generation when an earlier edit is acknowledged and ignores acknowledgements out of order', () => {
  const { client, sent, state, recover } = connection(createRecoveryJournal(() => localStorage))
  const journal = createRecoveryJournal(() => localStorage)
  recover()
  state()
  const first = base.source + ' first'
  const last = first + ' latest'
  client.edit(first)
  client.edit(last)
  state({ revision: 8, source: 'out of order', dirty: true }, { id: 2, accepted: true })
  state({ revision: 2, source: first, dirty: true }, { id: 1, accepted: true })
  state({ revision: 9, source: 'stale acknowledgement', dirty: true }, { id: 1, accepted: false })
  state({ revision: 8, source: 'wrong proposal', dirty: true }, { id: 2, accepted: true })
  expect(client.read()).toMatchObject({ source: last, pending: true })
  expect(journal.read(scope)).toMatchObject([{ id: journalId, source: last }])
  expect(sent.filter(message => message.type === 'edit')).toHaveLength(2)
  expect(sent.filter(message => message.type === 'dismiss')).toHaveLength(0)
  state({ revision: 3, source: last, dirty: true }, { id: 2, accepted: true })
  expect(client.read()).toMatchObject({ source: last, pending: false })
  expect(journal.read(scope)).toEqual([])
  client.dispose()
})

it('surfaces the journal after a disconnected view closes without posting edits to the reopened document', () => {
  const journal = createRecoveryJournal(() => localStorage)
  const original = connection(journal)
  original.recover()
  original.state({ eol: '\r\n', bom: true })
  original.client.edit(base.source + ' pending')
  original.client.dispose()

  const { client, sent, state, recover, receive } = connection(journal, reopenedId)
  recover()
  state({ source: 'new content under the same path' })
  expect(client.read()).toMatchObject({
    source: 'new content under the same path', pending: false,
    recovery: [{ id: journalId, source: base.source + ' pending', eol: '\r\n', bom: true, reason: 'pending' }],
  })
  expect(sent).toEqual([{ type: 'ready' }])
  client.discardRecovery(journalId)
  receive({ type: 'dismissed', id: journalId, generation: 1, dismissed: true })
  expect(journal.read(scope)).toEqual([])
  client.dispose()
})

it('asks for a missing acknowledgement, stops stalled synchronization, and records attempts that time out', () => {
  vi.useFakeTimers()
  const journal = createRecoveryJournal(() => localStorage)
  const { client, sent, state, recover } = connection(journal)
  try {
    recover()
    state()
    const pending = base.source + ' retained'
    client.edit(pending)
    client.run('save')
    vi.advanceTimersByTime(2000)
    expect(sent.at(-1)).toEqual({ type: 'status' })
    vi.advanceTimersByTime(8000)
    expect(sent).toContainEqual({ type: 'abandon', id: 1 })
    expect(sent.some(message => message.type === 'command')).toBe(false)
    expect(client.read()).toMatchObject({ conflict: pending, pending: false, source: base.source })
    expect(journal.read(scope)).toMatchObject([{ source: pending, reason: 'interrupted', native: { source: base.source } }])
    state({ revision: 2, source: pending, dirty: true }, { id: 1, accepted: true })
    expect(client.read().recovery).toMatchObject([{ source: pending }])
  } finally {
    client.dispose()
    vi.useRealTimers()
  }
})

it('waits for the recovery scope before accepting edits in a new webview', () => {
  const { client, sent, state, recover } = connection(createRecoveryJournal(() => localStorage))
  try {
    state()
    client.edit('during the handshake')
    expect(sent).toEqual([{ type: 'ready' }])
    recover()
    state()
    expect(client.read()).toMatchObject({ available: true, source: base.source })
  } finally { client.dispose() }
})

it('keeps a revert when an earlier edit could still commit after the acknowledgement timeout', () => {
  vi.useFakeTimers()
  const journal = createRecoveryJournal(() => localStorage)
  const { client, state, recover } = connection(journal)
  try {
    recover()
    state()
    const earlier = base.source + ' change'
    client.edit(earlier)
    client.edit(base.source)
    vi.advanceTimersByTime(10000)
    state({ revision: 2, source: earlier, dirty: true }, { id: 1, accepted: true })
    state({ revision: 2, source: earlier, dirty: true })
    expect(client.read()).toMatchObject({ source: earlier, conflict: base.source, pending: false })
    expect(journal.read(scope)).toMatchObject([{ source: base.source, reason: 'interrupted' }])
  } finally {
    client.dispose()
    vi.useRealTimers()
  }
})

it('clears an acknowledged host copy even when browser storage is inaccessible', () => {
  const journal = createRecoveryJournal(() => { throw new Error('Storage unavailable') })
  const { client, sent, state, recover, receive } = connection(journal)
  try {
    recover()
    state()
    client.edit(base.source + ' saved')
    expect(client.read().recoveryWarning).toBeDefined()
    receive({ type: 'stored', id: journalId, generation: 1, stored: true })
    expect(client.read().recoveryWarning).toBeUndefined()
    state({ revision: 2, source: base.source + ' saved' }, { id: 1, accepted: true })
    expect(sent).toContainEqual({ type: 'dismiss', id: journalId, generation: 1 })
    expect(client.read().recoveryWarning).toBeUndefined()
  } finally { client.dispose() }
})

it('keeps a newer unbacked draft pending when an older storage acknowledgement arrives', () => {
  const journal = createRecoveryJournal(() => { throw new Error('Storage unavailable') })
  const { client, state, recover, receive } = connection(journal)
  try {
    recover()
    state()
    client.edit(base.source + ' first')
    client.edit(base.source + ' first second')
    receive({ type: 'stored', id: journalId, generation: 1, stored: true })
    receive({ type: 'stored', id: journalId, generation: 2, stored: false })
    expect(client.read().recoveryWarning).toBeDefined()
    expect(client.read()).toMatchObject({ source: base.source + ' first second', pending: true })
    receive({ type: 'stored', id: journalId, generation: 2, stored: true })
    expect(client.read().recoveryWarning).toBeUndefined()
    expect(client.read().pending).toBe(true)
  } finally { client.dispose() }
})

it('waits for clipboard confirmation independently of a pending edit and reports failure', async () => {
  const { client, sent, state, receive } = connection()
  state()
  client.edit(base.source + ' pending')
  const finished = vi.fn()
  const transfer = client.copy('recovered Markdown').then(finished)
  expect(sent.at(-1)).toEqual({ type: 'copy', id: 1, text: 'recovered Markdown' })
  await Promise.resolve()
  expect(finished).not.toHaveBeenCalled()
  receive({ type: 'copied', id: 1, copied: true })
  await transfer
  expect(finished).toHaveBeenCalledOnce()
  const second = client.copy('second attempt')
  receive({ type: 'copied', id: 2, copied: false })
  await expect(second).rejects.toThrow('copy')
  client.dispose()
})
