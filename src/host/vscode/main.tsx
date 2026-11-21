import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '../../styles.css'
import App from '../../App'
import { createWebviewHost } from './host'
import { connectionMessage, isHostMessage, type ClientMessage } from './protocol'
import { createRecoveryJournal } from './recovery'

declare function acquireVsCodeApi(): { postMessage(message: { connection: string; message: ClientMessage }): void }

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  const theme = document.body.matches('.vscode-dark, .vscode-high-contrast') ? 'dark' : 'light'
  const platform = /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other'

  const loading = (message?: string) => <main className="app" data-theme={theme}>
    <p className="opening-state" role={message ? 'alert' : 'status'}>{message ?? 'Opening Markdown in VS Code…'}</p>
  </main>

  if (typeof acquireVsCodeApi !== 'function') root.render(loading('Open a Markdown document in VS Code to use the Folio editor.'))
  else {
    const vscode = acquireVsCodeApi()
    const connection = crypto.randomUUID()
    const post = (message: ClientMessage) => vscode.postMessage({ connection, message })
    const host = createWebviewHost({
      post,
      listen(listener) {
        const receive = (event: MessageEvent<unknown>) => {
          // VS Code relays messages from the same-origin outer webview and masks window.parent.
          if (event.origin === 'null' || event.origin !== window.origin) return
          const envelope = connectionMessage(event.data, isHostMessage)
          if (envelope?.connection === connection) listener(envelope.message)
        }
        window.addEventListener('message', receive)
        return () => window.removeEventListener('message', receive)
      },
    }, platform, theme, createRecoveryJournal(() => window.localStorage))

    const mount = () => {
      const state = host.liveDocument.read()
      if (!state.id) root.render(loading(state.message))
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
      host.liveDocument.dispose()
      root.unmount()
    }, { once: true })
  }
}
