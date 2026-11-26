import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, FileText, Info, RefreshCw, X } from 'lucide-react'
import type { Appearance } from '../../document/workspace'
import { IconButton } from '../../ui/controls'
import { PdfViewer } from '../../ui/pdf/PdfViewer'
import type { ClientMessage, HostMessage, PdfViewState } from './protocol'
import { onWebviewTheme } from './theme'

export interface PdfTransport {
  post(message: ClientMessage): void
  listen(listener: (message: HostMessage) => void): () => void
}

/** The VS Code read-only PDF shell around the shared Folio viewer. */
export function PdfWorkspace({ transport, initialTheme }: { transport: PdfTransport; initialTheme: Appearance['theme'] }) {
  const [theme, setTheme] = useState(initialTheme)
  const [state, setState] = useState<PdfViewState>()
  const [document, setDocument] = useState<{ revision: number; bytes: Uint8Array }>()
  const [toast, setToast] = useState('')
  const [findRequest, setFindRequest] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const copyId = useRef(0)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(''), 4300)
  }, [])

  useEffect(() => onWebviewTheme(setTheme), [])
  useEffect(() => {
    const stop = transport.listen(message => {
      if (message.type === 'pdfState') setState(message.state)
      else if (message.type === 'pdfBytes') setDocument({ revision: message.revision, bytes: new Uint8Array(message.bytes) })
    })
    transport.post({ type: 'ready' })
    return () => { stop(); window.clearTimeout(timer.current) }
  }, [transport])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setFindRequest(value => value + 1)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  const copyText = useCallback((text: string) => new Promise<void>((resolve, reject) => {
    const id = ++copyId.current
    const stop = transport.listen(message => {
      if (message.type !== 'copied' || message.id !== id) return
      stop()
      clearTimeout(expiry)
      if (message.copied) resolve()
      else reject(new Error('VS Code could not copy the text.'))
    })
    const expiry = setTimeout(() => { stop(); reject(new Error('VS Code did not confirm the copy.')) }, 5000)
    transport.post({ type: 'copy', id, text })
  }), [transport])

  const current = document && state && document.revision === state.revision ? document : undefined
  return <div className="app pdf-host" data-theme={theme}>
    <header className="topbar">
      <div className="brand" role="img" aria-label="Folio"><span className="brand-icon"><FileText size={21} strokeWidth={1.9} /></span><span>folio<span className="brand-period">.</span></span></div>
      <div className="topbar-divider" />
      <div className="document-identity"><span className="workspace-title" title={state?.uri}>{state?.title ?? 'PDF'}</span></div>
      <div className="topbar-actions"><span className="save-status status-saved" role="status">Read-only PDF</span></div>
    </header>
    {state && (state.changed || !state.available) && <div className="pdf-notices pdf-changed" role="alert">
      <span><CircleAlert size={13} aria-hidden="true" />{state.available ? 'This PDF changed on disk. Folio is showing the version that was opened.' : 'This PDF was moved or deleted. Folio is showing the version that was opened.'}</span>
      {state.available && <button type="button" className="secondary-button" onClick={() => transport.post({ type: 'pdfReload' })}><RefreshCw size={13} /> Reload from disk</button>}
    </div>}
    <main className="canvas pdf-host-canvas">
      {state?.failure ? <div className="pdf-state pdf-error" role="alert"><CircleAlert size={20} /><div><strong>This PDF cannot be displayed.</strong><p>{state.failure}</p></div></div>
        : <PdfViewer bytes={current?.bytes} documentKey={state ? state.uri + '#' + state.revision : ''} label={state?.title ?? 'PDF'} notify={notify} copyText={copyText} findRequest={findRequest} />}
    </main>
    {toast && <div className="toast" role="status"><Info size={16} /><span>{toast}</span><IconButton label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></IconButton></div>}
  </div>
}
