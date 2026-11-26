import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '../../styles.css'
import './scrollbars.css'
import './theme.css'
import App from '../../App'
import { LazyBoundary } from '../../LazyBoundary'
import { createWebviewHost } from './host'
import { connectionMessage, isHostMessage, type ClientMessage, type HostMessage } from './protocol'
import { createRecoveryJournal } from './recovery'
import { RecoveryNotice } from './RecoveryNotice'
import { webviewTheme } from './theme'
import { PdfWorkspace } from './PdfWorkspace'

const SpreadsheetWorkspace = lazy(() => import('./SpreadsheetWorkspace').then(module => ({ default: module.SpreadsheetWorkspace })))

declare function acquireVsCodeApi(): { postMessage(message: { connection: string; message: ClientMessage }): void }

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  const theme = webviewTheme()
  const platform = /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other'
  const format = document.querySelector('meta[name="folio-format"]')?.getAttribute('content') ?? 'Markdown'

  const loading = (message?: string) => <main className="app" data-theme={theme}>
    <p className="opening-state" role={message ? 'alert' : 'status'}>{message ?? `Opening ${format} in VS Code…`}</p>
  </main>

  if (typeof acquireVsCodeApi !== 'function') root.render(loading('Open a document in VS Code to use the Folio editor.'))
  else {
    const vscode = acquireVsCodeApi()
    const connection = crypto.randomUUID()
    const post = (message: ClientMessage) => vscode.postMessage({ connection, message })
    const transport = {
      post,
      listen(listener: (message: HostMessage) => void) {
        const receive = (event: MessageEvent<unknown>) => {
          // VS Code relays messages from the same-origin outer webview and masks window.parent.
          if (event.origin === 'null' || event.origin !== window.origin) return
          const envelope = connectionMessage(event.data, isHostMessage)
          if (envelope?.connection === connection) listener(envelope.message)
        }
        window.addEventListener('message', receive)
        return () => window.removeEventListener('message', receive)
      },
    }
    if (format === 'PDF') {
      // Read-only PDFs have no native text buffer, recovery journal or edit protocol.
      root.render(<PdfWorkspace transport={transport} initialTheme={theme} />)
      window.addEventListener('pagehide', () => root.unmount(), { once: true })
    } else if (format === 'XLSX' || format === 'CSV') {
      root.render(<LazyBoundary fallback={loading('The Folio spreadsheet editor could not load. Reopen the workbook to retry.')}>
        <Suspense fallback={loading()}><SpreadsheetWorkspace transport={transport} initialTheme={theme} /></Suspense>
      </LazyBoundary>)
      window.addEventListener('pagehide', () => root.unmount(), { once: true })
    } else mountEditor()
    function mountEditor() {
    const host = createWebviewHost(transport, platform, theme, createRecoveryJournal(() => window.localStorage), format)

    const mount = () => {
      const state = host.liveDocument.read()
      if (!state.id) root.render(loading(state.message))
      else if (state.format === 'docx' && !state.available) root.render(<main className="app" data-theme={theme}>
        <RecoveryNotice state={state} copy={host.clipboard.writeText} discard={host.liveDocument.discardRecovery} notify={() => undefined} />
      </main>)
      else {
        unsubscribe()
        root.render(<App host={host} />)
      }
    }
    const unsubscribe = host.liveDocument.subscribe(mount)
    mount()
    const refresh = () => {
      if (document.hidden) return
      try { post({ type: host.liveDocument.read().id ? 'status' : 'ready' }) }
      catch { /* The client will report a stalled connection. */ }
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('pagehide', () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      unsubscribe()
      host.dispose()
      root.unmount()
    }, { once: true })
    }
  }
}
