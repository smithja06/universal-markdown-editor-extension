import type { LiveDocument, LiveDocumentSnapshot } from '../contracts'
import { isHostMessage, rebaseSource, sourceChange, type ClientMessage, type DocumentState, type HostMessage } from './protocol'

export interface LiveDocumentTransport {
  post(message: ClientMessage): void
  listen(listener: (message: unknown) => void): () => void
}

interface PendingEdit { id: number; revision: number; base: string; proposal: string }
type NativeCommand = Parameters<LiveDocument['run']>[0]
type Acknowledgement = Extract<HostMessage, { type: 'state' }>['edit']

const closedMessage = 'This Markdown document is no longer available in VS Code.'
const conflictMessage = 'VS Code and Folio changed the same Markdown text. Copy your Folio draft before continuing.'
const rejectedMessage = 'VS Code could not apply this edit. Copy your Folio draft before continuing.'

export function createLiveDocumentClient(transport: LiveDocumentTransport): LiveDocument & { dispose(): void } {
  const listeners = new Set<(state: LiveDocumentSnapshot) => void>()
  const commands: NativeCommand[] = []
  let authoritative: DocumentState | undefined
  let deferred: DocumentState | undefined
  let inFlight: PendingEdit | undefined
  let desired = ''
  let conflict: string | undefined
  let message: string | undefined
  let nextEditId = 1
  let disposed = false
  let snapshot: LiveDocumentSnapshot = {
    id: '', title: '', source: '', lineEnding: '\n', available: false, dirty: false, pending: true,
  }

  function publish() {
    const nativeSource = authoritative?.source ?? ''
    const available = authoritative?.available ?? false
    const optimistic = available && conflict === undefined
    const source = optimistic ? desired : nativeSource
    const next: LiveDocumentSnapshot = {
      id: authoritative?.uri ?? '', title: authoritative?.title ?? '', source, lineEnding: authoritative?.eol ?? '\n',
      available, dirty: !!authoritative?.dirty || source !== nativeSource,
      pending: authoritative ? optimistic && (!!inFlight || source !== nativeSource) : message === undefined,
      conflict, message,
    }
    if ((Object.keys(next) as (keyof LiveDocumentSnapshot)[]).every(key => snapshot[key] === next[key])) return
    snapshot = next
    for (const listener of listeners) listener(next)
  }

  function preserveDraft(reason: string) {
    if (conflict === undefined && desired !== authoritative?.source) conflict = desired
    if (authoritative) desired = authoritative.source
    commands.length = 0
    message = reason
  }

  function flush() {
    if (!authoritative?.available || conflict !== undefined || inFlight || disposed) return
    const change = sourceChange(authoritative.source, desired)
    if (change) {
      const id = nextEditId++
      const { revision, source: base } = authoritative
      inFlight = { id, revision, base, proposal: desired }
      try { transport.post({ type: 'edit', id, revision, change }) }
      catch {
        inFlight = undefined
        preserveDraft('Folio could not send the edit to VS Code.')
      }
      return
    }
    for (const command of commands.splice(0)) {
      try { transport.post({ type: 'command', command }) }
      catch { message = 'Folio could not send the command to VS Code.'; break }
    }
  }

  function reconcile(state: DocumentState, acknowledgement?: Acknowledgement) {
    if (authoritative && (state.uri !== authoritative.uri || state.revision < authoritative.revision || !authoritative.available)) return
    if (!state.available) {
      authoritative = deferred && deferred.revision > state.revision ? { ...deferred, available: false } : state
      deferred = undefined
      if (inFlight) preserveDraft(closedMessage)
      else message = closedMessage
      inFlight = undefined
      commands.length = 0
      publish()
      return
    }
    if (inFlight) {
      if (acknowledgement?.id !== inFlight.id) {
        if (!deferred || state.revision >= deferred.revision) deferred = state
        return
      }
      const { base, proposal, revision } = inFlight
      if (acknowledgement.accepted && state.revision <= revision) return
      state = deferred && deferred.revision >= state.revision ? deferred : state
      inFlight = undefined
      deferred = undefined
      authoritative = state
      message = undefined
      const unchangedRevision = state.revision === revision && state.source === base
      const rebased = rebaseSource(acknowledgement.accepted ? proposal : base, desired, state.source)
      if (desired === state.source) desired = state.source
      else if (!acknowledgement.accepted && unchangedRevision) preserveDraft(acknowledgement.message || rejectedMessage)
      else if (rebased === undefined) preserveDraft(conflictMessage)
      else desired = rebased
    } else {
      if (authoritative && state.revision === authoritative.revision && state.source !== authoritative.source) return
      authoritative = state
      desired = state.source
      if (conflict === undefined) message = undefined
    }
    flush()
    publish()
  }

  const unlisten = transport.listen(incoming => {
    if (disposed || !isHostMessage(incoming)) return
    if (incoming.type === 'state') reconcile(incoming.state, incoming.edit)
    else if (conflict === undefined) { message = incoming.message; publish() }
  })
  try { transport.post({ type: 'ready' }) }
  catch { message = 'Folio could not connect to VS Code.'; publish() }

  return {
    read: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    edit(source) {
      if (disposed || !authoritative?.available || conflict !== undefined) return
      const normalized = source.replace(/\r\n?/g, '\n')
      if (desired === normalized) return
      desired = normalized
      message = undefined
      flush()
      publish()
    },
    run(command) {
      if (disposed || !authoritative?.available || conflict !== undefined) return
      commands.push(command)
      flush()
      publish()
    },
    discardConflict() {
      if (disposed || conflict === undefined) return
      conflict = undefined
      message = authoritative?.available ? undefined : closedMessage
      publish()
    },
    dispose() {
      if (disposed) return
      disposed = true
      commands.length = 0
      listeners.clear()
      unlisten()
    },
  }
}
