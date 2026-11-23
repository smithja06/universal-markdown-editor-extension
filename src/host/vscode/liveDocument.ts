import type { LiveDocument, LiveDocumentSnapshot } from '../contracts'
import { rebaseSource, sourceChange, type ClientMessage, type DocumentState, type HostMessage } from './protocol'
import type { RecoveryDraft, RecoveryJournal } from './recovery'

export interface LiveDocumentTransport {
  post(message: ClientMessage): void
  listen(listener: (message: HostMessage) => void): () => void
}

interface PendingEdit { id: number; revision: number; base: string; proposal: string }
type NativeCommand = Parameters<LiveDocument['run']>[0]
type Acknowledgement = Extract<HostMessage, { type: 'state' }>['edit']
type RecoveryContext = Extract<HostMessage, { type: 'recovery' }>

const closedMessage = 'This Markdown document is no longer available in VS Code.'
const conflictMessage = 'VS Code and Folio changed the same Markdown text. Review both versions before continuing.'
const rejectedMessage = 'VS Code could not apply this edit. Review your pending draft before continuing.'

export function createLiveDocumentClient(transport: LiveDocumentTransport, journal?: RecoveryJournal): LiveDocument & {
  copy(text: string): Promise<void>
  dispose(): void
} {
  const listeners = new Set<(state: LiveDocumentSnapshot) => void>()
  const commands: NativeCommand[] = []
  let authoritative: DocumentState | undefined
  let deferred: DocumentState | undefined
  let inFlight: PendingEdit | undefined
  let desired = ''
  let conflict: string | undefined
  let message: string | undefined
  let recoveryWarning: string | undefined
  let recoveryContext: RecoveryContext | undefined
  let backupBase: Pick<DocumentState, 'revision' | 'source'> | undefined
  let draft: RecoveryDraft | undefined
  let archived: readonly RecoveryDraft[] = []
  const dismissing = new Map<string, { generation: number; committed: boolean }>()
  const dismissed = new Map<string, number>()
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let nextEditId = 1
  let nextCopyId = 1
  const copies = new Map<number, (copied: boolean) => void>()
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
      id: authoritative?.uri ?? '', title: authoritative?.title ?? '', source, revision: authoritative?.revision, lineEnding: authoritative?.eol ?? '\n',
      available, dirty: !!authoritative?.dirty || source !== nativeSource,
      pending: authoritative ? optimistic && (!!inFlight || source !== nativeSource) : message === undefined,
      conflict, message, recovery: archived, recoveryWarning,
    }
    if ((Object.keys(next) as (keyof LiveDocumentSnapshot)[]).every(key => snapshot[key] === next[key])) return
    snapshot = next
    for (const listener of listeners) listener(next)
  }

  function refreshRecovery() {
    if (!recoveryContext) return
    const { scope, active, drafts } = recoveryContext
    const activeIds = new Set(active)
    const byId = new Map<string, RecoveryDraft>()
    function add(entry: RecoveryDraft) {
      if ((dismissed.get(entry.id) ?? 0) >= entry.generation) return
      if ((byId.get(entry.id)?.generation ?? 0) <= entry.generation) byId.set(entry.id, entry)
    }
    for (const entry of drafts) add(entry)
    try {
      for (const entry of journal?.read(scope) ?? []) if (!activeIds.has(entry.id)) add(entry)
    } catch { /* Extension-host copies remain available. */ }
    if (draft && draft.reason !== 'pending') add(draft)
    const entries = [...byId.values()]
    if (archived.length !== entries.length || archived.some((entry, i) => entry.id !== entries[i].id || entry.generation !== entries[i].generation)) archived = entries
  }

  function checkpoint(reason: RecoveryDraft['reason'] = 'pending') {
    if (!recoveryContext || !authoritative) return
    const { id, scope } = recoveryContext
    const { uri, eol, bom, source } = authoritative
    if (reason === 'pending' && draft?.reason === reason && draft.source === desired && draft.eol === eol && draft.bom === !!bom) return
    draft = {
      id, uri, generation: ++generation, reason, source: desired,
      eol: reason === 'pending' ? eol : draft?.eol ?? eol,
      bom: reason === 'pending' ? !!bom : draft?.bom ?? !!bom,
      native: reason === 'pending' ? undefined : { source, eol, bom: !!bom },
    }
    try {
      if (!journal) throw new Error('Webview recovery storage unavailable.')
      journal.write(scope, draft)
      recoveryWarning = undefined
    } catch {
      recoveryWarning = 'This draft has no confirmed recovery copy yet. Keep this editor open and copy your Markdown if synchronization stalls.'
    }
    try {
      if (reason === 'pending' && backupBase && backupBase.source.length >= 64_000) {
        const change = sourceChange(backupBase.source, desired)
        if (!change || change.text.length <= 64_000) {
          transport.post({ type: 'checkpoint', draft: {
            id, uri, generation: draft.generation, bom: draft.bom, eol: draft.eol, baseRevision: backupBase.revision, change,
          } })
          return
        }
      }
      transport.post({ type: 'checkpoint', draft })
    } catch { /* The webview recovery copy stays intact. */ }
    if (reason !== 'pending') refreshRecovery()
  }

  function removeLocal(entry: RecoveryDraft) {
    if (!recoveryContext) return true
    try {
      journal?.remove(recoveryContext.scope, entry)
      return true
    } catch { return false }
  }

  function dismiss(entry: RecoveryDraft, committed: boolean) {
    if (!recoveryContext) return
    if (committed) {
      removeLocal(entry)
      draft = undefined
      recoveryWarning = undefined
    }
    try {
      dismissing.set(entry.id, { generation: entry.generation, committed })
      transport.post({ type: 'dismiss', id: entry.id, generation: entry.generation })
    } catch {
      dismissing.delete(entry.id)
      if (!committed) recoveryWarning = 'Folio could not clear this recovery copy. Try again when VS Code is connected.'
    }
  }

  function preserveDraft(reason: string, outcome: RecoveryDraft['reason']) {
    if (conflict === undefined && (draft?.reason === 'pending' || desired !== authoritative?.source)) {
      conflict = desired
      checkpoint(outcome)
    }
    if (authoritative) desired = authoritative.source
    commands.length = 0
    message = reason
  }

  function watch(edit: PendingEdit) {
    timer = setTimeout(() => {
      if (inFlight !== edit) return
      try { transport.post({ type: 'status' }) } catch { /* The edit may still be pending. */ }
      if (inFlight !== edit) return
      timer = setTimeout(() => {
        if (inFlight !== edit) return
        inFlight = undefined
        if (deferred) authoritative = deferred
        deferred = undefined
        try { transport.post({ type: 'abandon', id: edit.id }) } catch { /* The host may be offline. */ }
        preserveDraft('VS Code did not acknowledge this edit. Review the pending draft before continuing.', 'interrupted')
        publish()
      }, 8000)
    }, 2000)
  }

  function flush() {
    if (!authoritative?.available || conflict !== undefined || inFlight || disposed) return
    const change = sourceChange(authoritative.source, desired)
    if (change) {
      const id = nextEditId++
      const { revision, source: base } = authoritative
      inFlight = { id, revision, base, proposal: desired }
      if (recoveryContext) watch(inFlight)
      try { transport.post({ type: 'edit', id, revision, change }) }
      catch {
        clearTimeout(timer)
        inFlight = undefined
        preserveDraft('Folio could not send the edit to VS Code.', 'interrupted')
      }
      return
    }
    if (draft) dismiss(draft, true)
    for (const command of commands.splice(0)) {
      try { transport.post({ type: 'command', command }) }
      catch { message = 'Folio could not send the command to VS Code.'; break }
    }
  }

  function reconcile(state: DocumentState, acknowledgement?: Acknowledgement) {
    if (authoritative && (state.uri !== authoritative.uri || state.revision < authoritative.revision || !authoritative.available)) return
    if (acknowledgement && acknowledgement.id !== inFlight?.id) return
    if (!backupBase && state.available && state.revision === recoveryContext?.baseRevision) {
      backupBase = { revision: state.revision, source: state.source }
    }
    if (!state.available) {
      authoritative = deferred && deferred.revision > state.revision ? { ...deferred, available: false } : state
      deferred = undefined
      if (inFlight || draft?.reason === 'pending') preserveDraft(closedMessage, 'unavailable')
      else message = closedMessage
      clearTimeout(timer)
      inFlight = undefined
      commands.length = 0
      publish()
      return
    }
    if (inFlight) {
      if (!acknowledgement) {
        if (!deferred || state.revision >= deferred.revision) deferred = state
        return
      }
      const { base, proposal, revision } = inFlight
      if (acknowledgement.accepted && (state.revision <= revision || state.source !== proposal)) return
      state = deferred && deferred.revision >= state.revision ? deferred : state
      clearTimeout(timer)
      inFlight = undefined
      deferred = undefined
      authoritative = state
      message = undefined
      const unchangedRevision = state.revision === revision && state.source === base
      const rebased = rebaseSource(acknowledgement.accepted ? proposal : base, desired, state.source)
      if (desired === state.source) desired = state.source
      else if (!acknowledgement.accepted && unchangedRevision) preserveDraft(acknowledgement.message || rejectedMessage, 'rejected')
      else if (rebased === undefined) preserveDraft(conflictMessage, 'conflict')
      else {
        desired = rebased
        if (desired !== state.source) checkpoint()
      }
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
    if (disposed) return
    switch (incoming.type) {
      case 'state':
        if (journal && !recoveryContext) break
        if (!authoritative) clearTimeout(timer)
        reconcile(incoming.state, incoming.edit)
        break
      case 'accepted': {
        const edit = inFlight
        if (edit?.id === incoming.edit.id) reconcile({ ...incoming.state, source: edit.proposal }, { id: edit.id, accepted: true })
        break
      }
      case 'recovery':
        if (recoveryContext && (incoming.id !== recoveryContext.id || incoming.scope !== recoveryContext.scope)) break
        recoveryContext = incoming
        refreshRecovery()
        publish()
        break
      case 'stored':
        if (incoming.id === draft?.id && incoming.generation === draft.generation && incoming.stored) {
          recoveryWarning = undefined
          publish()
        }
        break
      case 'dismissed': {
        const cleanup = dismissing.get(incoming.id)
        if (!cleanup || cleanup.generation !== incoming.generation) break
        dismissing.delete(incoming.id)
        if (cleanup.committed) break
        const entry = archived.find(item => item.id === incoming.id && item.generation === incoming.generation)
        if (!entry) break
        if (incoming.dismissed) {
          const removed = removeLocal(entry)
          dismissed.set(entry.id, entry.generation)
          if (entry.id === draft?.id) {
            draft = undefined
            conflict = undefined
            message = authoritative?.available ? undefined : closedMessage
          }
          recoveryWarning = removed ? undefined : 'VS Code cleared its copy. Webview storage is unavailable, so its copy may appear again.'
          refreshRecovery()
        } else {
          recoveryWarning = 'Folio could not clear this recovery copy. Try again when storage is available.'
        }
        publish()
        break
      }
      case 'copied':
        copies.get(incoming.id)?.(incoming.copied)
        break
      case 'error':
        if (conflict === undefined) { message = incoming.message; publish() }
    }
  })
  if (journal) timer = setTimeout(() => {
    if (authoritative) return
    message = 'Folio could not connect to VS Code. Reopen this editor to reconnect.'
    publish()
  }, 10000)
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
      checkpoint()
      flush()
      publish()
    },
    run(command) {
      if (disposed || !authoritative?.available || conflict !== undefined) return
      commands.push(command)
      flush()
      publish()
    },
    copy(text) {
      return new Promise((resolve, reject) => {
        if (disposed) return reject(new Error('The Folio editor is closed.'))
        const id = nextCopyId++
        const timeout = setTimeout(() => complete(false), 5000)
        function complete(copied: boolean) {
          clearTimeout(timeout)
          copies.delete(id)
          if (copied) resolve()
          else reject(new Error('Folio could not copy to the clipboard. Select the Markdown in the preview to copy it manually.'))
        }
        copies.set(id, complete)
        try { transport.post({ type: 'copy', id, text }) } catch { complete(false) }
      })
    },
    discardRecovery(id) {
      if (disposed) return
      const entry = archived.find(item => item.id === id)
      if (!entry) return
      dismiss(entry, false)
      publish()
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearTimeout(timer)
      for (const complete of copies.values()) complete(false)
      commands.length = 0
      listeners.clear()
      unlisten()
    },
  }
}
