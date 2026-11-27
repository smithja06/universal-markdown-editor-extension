import { createHash } from 'node:crypto'
import * as vscode from 'vscode'
import { looksLikePdf, pdfLimits } from '../../src/document/formats/pdf/model'
import { connectionMessage, isClientMessage, type HostMessage, type PdfViewState } from '../../src/host/vscode/protocol'
import { isLocalDocumentFile, readLocalDocument } from './localDocumentFile'
import { attachAppearance } from './appearance'
import { webviewHtml } from './webview'

export const pdfViewType = 'folio.pdf'
const maxCopyCharacters = 8 * 1024 * 1024

const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 900) : 'Folio could not read this PDF.'
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export class PdfDocument implements vscode.CustomDocument {
  readonly lifetime = new AbortController()
  bytes?: Uint8Array<ArrayBuffer>
  fingerprint?: string
  failure?: string
  revision = 0
  changed = false
  available = true
  constructor(readonly uri: vscode.Uri) {}
  dispose() {
    this.lifetime.abort()
    this.bytes = undefined
  }
}

async function readPdf(uri: vscode.Uri, signal: AbortSignal) {
  if (!vscode.workspace.isTrusted || !isLocalDocumentFile(uri)) {
    throw new Error('Folio PDF viewing requires a trusted workspace and a local file. Use another PDF viewer for this location.')
  }
  const bytes = await readLocalDocument(uri, pdfLimits.fileBytes, signal)
  if (!looksLikePdf(bytes)) throw new Error('This file does not start with a PDF header.')
  return bytes
}

interface View { panel: vscode.WebviewPanel; connection?: string }

/** A read-only editor. It never writes the workspace file and never reports a dirty state. */
export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider<PdfDocument> {
  private readonly views = new Map<PdfDocument, Set<View>>()

  constructor(private readonly assets: vscode.Uri) {}

  async openCustomDocument(uri: vscode.Uri, _context: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken) {
    const document = new PdfDocument(uri)
    const controller = new AbortController()
    const cancel = token.onCancellationRequested(() => controller.abort())
    try { this.install(document, await readPdf(uri, AbortSignal.any([controller.signal, document.lifetime.signal]))) }
    catch (error) {
      if (token.isCancellationRequested) throw new vscode.CancellationError()
      document.failure = message(error)
    } finally { cancel.dispose() }
    return document
  }

  private install(document: PdfDocument, bytes: Uint8Array<ArrayBuffer>) {
    document.bytes = bytes
    document.fingerprint = digest(bytes)
    document.failure = undefined
    document.changed = false
    document.available = true
    document.revision++
  }

  private state(document: PdfDocument): PdfViewState {
    return { uri: document.uri.toString(), title: document.uri.path.split('/').at(-1) || 'PDF', revision: document.revision,
      available: document.available, changed: document.changed, failure: document.failure, fingerprint: document.fingerprint }
  }

  private post(view: View, payload: HostMessage) {
    if (view.connection) void Promise.resolve(view.panel.webview.postMessage({ connection: view.connection, message: payload })).catch(() => undefined)
  }

  private publish(document: PdfDocument, bytes = false) {
    for (const view of this.views.get(document) ?? []) this.send(document, view, bytes)
  }

  private send(document: PdfDocument, view: View, bytes: boolean) {
    this.post(view, { type: 'pdfState', state: this.state(document) })
    // postMessage transfers ArrayBuffers without JSON expansion. Send a copy so the document keeps its bytes.
    if (bytes && document.bytes) this.post(view, { type: 'pdfBytes', revision: document.revision, bytes: document.bytes.slice().buffer })
  }

  private async check(document: PdfDocument) {
    if (!document.fingerprint || document.lifetime.signal.aborted) return
    let changed = true
    let available = true
    try { changed = digest(await readPdf(document.uri, document.lifetime.signal)) !== document.fingerprint }
    catch (error) {
      if (document.lifetime.signal.aborted) return
      available = !(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')
    }
    if (changed === document.changed && available === document.available) return
    document.changed = changed
    document.available = available
    this.publish(document)
  }

  private async reload(document: PdfDocument) {
    try { this.install(document, await readPdf(document.uri, document.lifetime.signal)) }
    catch (error) {
      if (document.lifetime.signal.aborted) return
      document.failure = message(error)
      document.revision++
    }
    this.publish(document, true)
  }

  async resolveCustomEditor(document: PdfDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken) {
    panel.webview.options = { enableScripts: true, enableForms: true, localResourceRoots: [this.assets] }
    const html = await webviewHtml(panel.webview, this.assets, 'PDF')
    if (token.isCancellationRequested) return
    const view: View = { panel }
    const views = this.views.get(document) ?? new Set()
    views.add(view)
    this.views.set(document, views)
    let timer: ReturnType<typeof setTimeout> | undefined
    const verify = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void this.check(document) }, 200)
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), '*'))
    const own = (uri: vscode.Uri) => uri.toString().toLowerCase() === document.uri.toString().toLowerCase()
    const subscriptions = [
      watcher,
      ...[watcher.onDidChange, watcher.onDidCreate, watcher.onDidDelete].map(event => event(uri => { if (own(uri)) verify() })),
      panel.onDidChangeViewState(() => { if (panel.active) verify() }),
      panel.webview.onDidReceiveMessage((incoming: unknown) => {
        const envelope = connectionMessage(incoming, isClientMessage)
        if (!envelope) return
        const { connection, message: request } = envelope
        if (request.type === 'ready') {
          view.connection = connection
          this.send(document, view, true)
          verify()
          return
        }
        if (view.connection !== connection) return
        if (request.type === 'pdfReload') void this.reload(document)
        else if (request.type === 'status') this.post(view, { type: 'pdfState', state: this.state(document) })
        else if (request.type === 'copy') {
          const { id, text } = request
          if (text.length > maxCopyCharacters) return this.post(view, { type: 'copied', id, copied: false })
          void vscode.env.clipboard.writeText(text).then(
            () => this.post(view, { type: 'copied', id, copied: true }),
            () => this.post(view, { type: 'copied', id, copied: false }),
          )
        }
      }),
    ]
    panel.onDidDispose(() => {
      clearTimeout(timer)
      for (const subscription of subscriptions) subscription.dispose()
      views.delete(view)
      view.connection = undefined
      if (!views.size) this.views.delete(document)
    })
    attachAppearance(panel)
    panel.webview.html = html
  }
}

