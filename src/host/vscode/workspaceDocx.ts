import type { FolioHost } from '../contracts'
import type { LiveDocumentTransport } from './liveDocument'

export function createWorkspaceDocx(transport: LiveDocumentTransport) {
  let nextId = 0
  const lifetime = new AbortController()
  const file: NonNullable<FolioHost['workspaceDocx']>['file'] = (kind, revision, callerSignal) => {
    const signal = AbortSignal.any(callerSignal ? [lifetime.signal, callerSignal] : [lifetime.signal])
    signal.throwIfAborted()
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        unsubscribe()
      }
      const abort = () => {
        stop()
        try { transport.post({ type: 'cancelDocxFile', id }) } catch { /* This webview may have closed. */ }
        reject(new DOMException('DOCX download cancelled.', 'AbortError'))
      }
      const unsubscribe = transport.listen(message => {
        if (message.type !== 'docxFileResult' || message.id !== id) return
        stop()
        if ('error' in message) reject(new Error(message.error))
        else resolve(new Uint8Array(message.bytes))
      })
      const timer = setTimeout(() => {
        stop()
        try { transport.post({ type: 'cancelDocxFile', id }) } catch { /* The request already expired. */ }
        reject(new Error('VS Code did not return the DOCX package in time.'))
      }, 30_000)
      signal.addEventListener('abort', abort, { once: true })
      try { transport.post({ type: 'docxFile', id, kind, revision }) }
      catch (error) { stop(); reject(new Error('Could not request the DOCX package.', { cause: error })) }
    })
  }
  return { file, dispose: () => lifetime.abort() }
}
