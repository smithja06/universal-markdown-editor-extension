import type { FolioHost } from '../contracts'
import type { LiveDocumentTransport } from './liveDocument'

/** Sends a reviewed PDF to the extension host, which saves it as a new file chosen in VS Code. */
export function createPdfCopy(transport: LiveDocumentTransport): NonNullable<FolioHost['pdfExport']> {
  let nextId = 0
  return {
    save(filename, bytes, revision) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const stop = transport.listen(message => {
          if (message.type !== 'pdfExportResult' || message.id !== id) return
          stop()
          if (message.status === 'error') reject(new Error(message.message ?? 'VS Code could not save the PDF copy.'))
          else resolve(message.status === 'saved' ? { status: 'saved', name: message.name ?? filename } : { status: 'cancelled' })
        })
        // The copy leaves the webview as a transferable buffer. The host owns the save dialog and timing.
        try { transport.post({ type: 'pdfExport', id, revision, filename, bytes: bytes.slice().buffer }) }
        catch (error) { stop(); reject(new Error('Could not send the PDF to VS Code.', { cause: error })) }
      })
    },
  }
}
