import { useCallback, useEffect, useRef, useState } from 'react'
import type { CsvDialect, Workbook } from '../../document/formats/spreadsheet/model'
import type { Appearance } from '../../document/workspace'
import { SpreadsheetEditor, type SpreadsheetExportRequest } from '../../ui/spreadsheet/SpreadsheetEditor'
import { sourceChange, type ClientMessage, type HostMessage } from './protocol'
import { isRecord } from './recovery'
import { isSpreadsheetClientMessage, readSpreadsheetSnapshot, type SpreadsheetState } from './spreadsheetProtocol'
import { onWebviewTheme } from './theme'
import './spreadsheetWorkspace.css'

interface SpreadsheetTransport {
  post(message: ClientMessage): void
  listen(listener: (message: HostMessage) => void): () => void
}
interface Snapshot { workbook: Workbook; source: string }
type FileRequest = Extract<ClientMessage, { type: 'spreadsheetExport' | 'spreadsheetOriginal' | 'spreadsheetCsvDialect' }>
type FileResult = Extract<HostMessage, { type: 'spreadsheetFileResult' }>
type Edit = Extract<ClientMessage, { type: 'spreadsheetEdit' }>
const maxLocalDraft = 2 * 1024 * 1024

function readPending(state: SpreadsheetState): Snapshot | undefined {
  try {
    const saved = localStorage.getItem('folio.spreadsheet.pending.' + state.uri)
    if (!saved || saved.length > maxLocalDraft + 1024) return
    const value: unknown = JSON.parse(saved)
    if (!isRecord(value) || value.fingerprint !== state.fingerprint || typeof value.source !== 'string' || value.source === state.source) return
    return { source: value.source, workbook: readSpreadsheetSnapshot(value.source) }
  } catch { /* Native checkpoints remain available when webview storage is disabled. */ }
}

function storePending(state: SpreadsheetState, draft?: Snapshot) {
  const key = 'folio.spreadsheet.pending.' + state.uri
  try {
    if (!draft) localStorage.removeItem(key)
    else if (state.fingerprint && draft.source.length <= maxLocalDraft) {
      localStorage.setItem(key, JSON.stringify({ fingerprint: state.fingerprint, source: draft.source }))
    }
  } catch { /* The native host owns acknowledged drafts. */ }
}

export function SpreadsheetWorkspace({ transport, initialTheme }: { transport: SpreadsheetTransport; initialTheme: Appearance['theme'] }) {
  const [theme, setTheme] = useState(initialTheme)
  const [state, setState] = useState<SpreadsheetState>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [editing, setEditing] = useState(false)
  const [recovery, setRecovery] = useState<Snapshot>()
  const [result, setResult] = useState<{ message: string; alert: boolean }>()
  const [fileActive, setFileActive] = useState('')
  const host = useRef<SpreadsheetState>(undefined)
  const committed = useRef<Snapshot>(undefined)
  const next = useRef<Snapshot>(undefined)
  const pending = useRef<{ message: Edit; snapshot: Snapshot }>(undefined)
  const seq = useRef(0)
  const file = useRef<{ id: number; finish: (message: FileResult) => void }>(undefined)

  const updateHost = useCallback((value: SpreadsheetState) => {
    host.current = value
    setState(value)
  }, [])

  const sendEdit = useCallback(() => {
    const draft = next.current
    const base = committed.current
    const native = host.current
    if (!draft || !base || !native || pending.current) return
    const change = sourceChange(base.source, draft.source)
    if (!change) {
      next.current = undefined
      storePending(native)
      setEditing(false)
      return
    }
    const message = { type: 'spreadsheetEdit' as const, id: ++seq.current, revision: native.revision, change }
    if (!isSpreadsheetClientMessage(message)) {
      setResult({ message: 'The edit exceeds Folio’s workspace draft limit.', alert: true })
      setSnapshot(base)
      setRecovery(draft)
      next.current = undefined
      setEditing(false)
      return
    }
    pending.current = { message, snapshot: draft }
    transport.post(message)
  }, [transport])

  useEffect(() => onWebviewTheme(setTheme), [])
  useEffect(() => {
    const listen = transport.listen(message => {
      if (message.type === 'error') {
        setResult({ message: message.message, alert: true })
      } else if (message.type === 'spreadsheetAccepted') {
        const sent = pending.current
        const native = host.current
        if (!native || sent?.message.id !== message.id || message.state.revision < native.revision) return
        pending.current = undefined
        committed.current = sent.snapshot
        updateHost({ ...native, ...message.state, source: sent.snapshot.source })
        sendEdit()
      } else if (message.type === 'spreadsheetState') {
        const native = host.current
        const incoming = message.state
        if (native && incoming.revision < native.revision) return
        updateHost(incoming)
        if (incoming.source === undefined) return
        if (!message.rejected) {
          const sent = pending.current
          if (sent?.snapshot.source === incoming.source) {
            pending.current = undefined
            committed.current = sent.snapshot
            sendEdit()
            return
          }
          if (committed.current?.source === incoming.source && native?.revision === incoming.revision) {
            if (sent) transport.post(sent.message)
            return
          }
        }
        try {
          const installed = { source: incoming.source, workbook: readSpreadsheetSnapshot(incoming.source) }
          if (message.rejected || next.current && next.current.source !== incoming.source) {
            setRecovery(next.current)
            setResult({ message: message.rejected?.message ?? 'A pending edit conflicts with the current workbook revision.', alert: true })
          } else if (!native) {
            setRecovery(readPending(incoming))
          }
          next.current = undefined
          pending.current = undefined
          committed.current = installed
          setSnapshot(installed)
          setEditing(false)
        } catch (error) {
          setResult({ message: error instanceof Error ? error.message : 'The workspace draft could not be opened.', alert: true })
        }
      } else if (message.type === 'spreadsheetFileResult' && file.current?.id === message.id) {
        file.current.finish(message)
      }
    })
    transport.post({ type: 'ready' })
    const refresh = () => { if (!document.hidden && host.current) transport.post({ type: 'status' }) }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      listen()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      const request = file.current
      if (request) {
        transport.post({ type: 'spreadsheetCancel', id: request.id })
        request.finish({ type: 'spreadsheetFileResult', id: request.id, status: 'cancelled' })
      }
    }
  }, [sendEdit, transport, updateHost])

  function apply(draft: Snapshot) {
    const native = host.current
    if (!native) return
    next.current = draft
    setSnapshot(draft)
    setEditing(true)
    storePending(native, draft)
    sendEdit()
  }

  function deliver(request: FileRequest, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (file.current) return Promise.reject(new Error('Finish the current workbook export first.'))
    if (!isSpreadsheetClientMessage(request)) return Promise.reject(new Error('Choose a valid filename and a supported export size.'))
    setFileActive(request.type === 'spreadsheetCsvDialect' ? 'Reading the original CSV…' : 'Preparing the workbook copy…')
    return new Promise<void>((resolve, reject) => {
      const cancel = () => transport.post({ type: 'spreadsheetCancel', id: request.id })
      signal?.addEventListener('abort', cancel, { once: true })
      file.current = { id: request.id, finish: response => {
        signal?.removeEventListener('abort', cancel)
        file.current = undefined
        setFileActive('')
        if (response.status === 'error') reject(new Error(response.message || 'VS Code could not save this copy.'))
        else {
          if (response.status === 'saved') setResult({ message: `Saved ${response.name ?? 'workbook copy'}.`, alert: false })
          resolve()
        }
      } }
      transport.post(request)
    })
  }

  async function exportFile(request: SpreadsheetExportRequest) {
    const native = host.current
    if (!native || next.current || pending.current || committed.current?.workbook !== request.confirmedWorkbook) {
      throw new Error('The workbook changed or is still syncing. Start a new export from the current draft.')
    }
    const base = { type: 'spreadsheetExport' as const, id: ++seq.current, revision: native.revision, filename: request.filename }
    if (request.format === 'png') {
      const { buffer, byteOffset, byteLength } = request.bytes
      const bytes = byteOffset === 0 && byteLength === buffer.byteLength ? buffer : buffer.slice(byteOffset, byteOffset + byteLength)
      return deliver({ ...base, format: 'png', bytes }, request.signal)
    }
    if (request.format === 'xlsx') return deliver({
      ...base, format: 'xlsx', sheetId: request.sheetId, includeCalculated: request.includeCalculated,
    }, request.signal)
    if (!request.csvSafety) throw new Error('Choose how formula-like CSV text should be handled.')
    return deliver({ ...base, format: 'csv', sheetId: request.sheetId, safety: request.csvSafety, delimiter: request.delimiter }, request.signal)
  }

  function saveOriginal() {
    const native = host.current
    if (!native || next.current || pending.current) return
    void deliver({ type: 'spreadsheetOriginal', id: ++seq.current, revision: native.revision })
      .catch(error => setResult({ message: error instanceof Error ? error.message : 'VS Code could not save the original.', alert: true }))
  }

  function reinterpretDelimiter(delimiter: CsvDialect['delimiter']) {
    const native = host.current
    if (!native || next.current || pending.current) return Promise.reject(new Error('Wait for the draft to finish syncing.'))
    return deliver({ type: 'spreadsheetCsvDialect', id: ++seq.current, revision: native.revision, delimiter })
  }

  function command(command: 'undo' | 'redo' | 'revert') {
    if (!pending.current) transport.post({ type: 'spreadsheetCommand', command })
  }

  const format = state?.format
  return <main className="app spreadsheet-native" data-theme={theme}>
    {state?.failure ? <p className="opening-state" role="alert">Folio could not open this workbook. {state.failure}</p>
      : !snapshot || !state || !format ? <p className="opening-state" role="status">Opening workbook in VS Code…</p>
        : <>
          {state.notice && <div className="spreadsheet-native-notice" role="alert">
            <span>{state.notice}</span>
            {state.external && <button type="button" className="secondary-button" disabled={editing} onClick={() => command('revert')}>Revert from disk</button>}
          </div>}
          {recovery && <div className="spreadsheet-native-notice" role="alert">
            <span>A pending workbook edit is available from this webview. Restoring it replaces the visible draft as a native edit.</span>
            <button type="button" className="secondary-button" onClick={() => { setRecovery(undefined); apply(recovery) }}>Restore pending edit</button>
            <button type="button" className="secondary-button" onClick={() => { storePending(state); setRecovery(undefined) }}>Discard pending edit</button>
          </div>}
          <SpreadsheetEditor key={state.uri + '#' + (state.fingerprint ?? '')}
            workbook={snapshot.workbook} format={format} title={state.title}
            onChange={workbook => apply({ workbook, source: JSON.stringify(workbook) })}
            readOnly={!!recovery}
            status={editing ? 'Syncing draft…' : state.dirty ? 'Draft saved locally' : 'Opened from disk'}
            saveLabel="Save draft" onSave={() => setResult({ message: editing ? 'Waiting for VS Code to finish syncing this draft.'
              : state.dirty ? 'The draft is recoverable in VS Code. Export a copy to create a new workbook file.'
                : 'Export a copy to create a separate workbook file.', alert: false })}
            onOriginal={saveOriginal} onExport={exportFile}
            onCsvDialect={format === 'csv' && !state.dirty ? reinterpretDelimiter : undefined}
            onUndo={() => command('undo')} onRedo={() => command('redo')}
            canUndo={!editing && !recovery && state.canUndo} canRedo={!editing && !recovery && state.canRedo} />
        </>}
    {fileActive && <div className="spreadsheet-native-notice" role="status">
      <span>{fileActive}</span>
      <button type="button" className="secondary-button" onClick={() => {
        if (file.current) transport.post({ type: 'spreadsheetCancel', id: file.current.id })
      }}>Cancel export</button>
    </div>}
    {result && <div className="spreadsheet-native-notice" role={result.alert ? 'alert' : 'status'}>
      <span>{result.message}</span>
      <button type="button" className="secondary-button" onClick={() => setResult(undefined)}>Dismiss</button>
    </div>}
  </main>
}
