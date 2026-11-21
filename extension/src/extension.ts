import * as vscode from 'vscode'
import { isClientMessage, spliceSource, type ClientMessage, type DocumentState, type HostMessage } from '../../src/host/vscode/protocol'
import { webviewHtml } from './webview'

const viewType = 'folio.markdown'
const unavailable = 'This document was moved, deleted, or closed. Reopen it from VS Code to continue.'
const stale = 'The document changed in VS Code before this edit could be applied.'

type StateMessage = Extract<HostMessage, { type: 'state' }>
type EditMessage = Extract<ClientMessage, { type: 'edit' }>
type CommandMessage = Extract<ClientMessage, { type: 'command' }>

interface View {
  panel: vscode.WebviewPanel
  ready: boolean
  disposed: boolean
  lastEdit: number
  undelivered?: StateMessage
  subscriptions: vscode.Disposable[]
}

interface Session {
  document: vscode.TextDocument
  state: DocumentState
  views: Set<View>
  operations: Promise<void>
  queued: number
  pending?: { view: View; expected: string; committed?: DocumentState }
  watcher?: vscode.Disposable
}

function documentState(document: vscode.TextDocument, available: boolean): DocumentState {
  return {
    uri: document.uri.toString(),
    title: document.uri.path.split('/').at(-1) || document.fileName,
    revision: document.version,
    source: document.getText().replace(/\r\n?/g, '\n'),
    dirty: document.isDirty,
    eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    available,
  }
}

function position(source: string, offset: number): vscode.Position {
  let line = 0
  let previous = -1
  for (let newline = source.indexOf('\n'); newline !== -1 && newline < offset; newline = source.indexOf('\n', newline + 1)) {
    line++
    previous = newline
  }
  return new vscode.Position(line, offset - previous - 1)
}

function within(resource: vscode.Uri, root: vscode.Uri): boolean {
  if (resource.scheme !== root.scheme || resource.authority !== root.authority) return false
  const insensitive = resource.scheme === 'file' && process.platform === 'win32'
  const path = insensitive ? resource.path.toLowerCase() : resource.path
  const prefix = (insensitive ? root.path.toLowerCase() : root.path).replace(/\/$/, '')
  return path === prefix || path.startsWith(prefix + '/')
}

export class FolioEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly sessions = new Map<vscode.TextDocument, Session>()
  private readonly subscriptions: vscode.Disposable[]

  constructor(private readonly assetsRoot: vscode.Uri) {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        const session = this.sessions.get(document)
        if (session) this.refresh(session)
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        const session = this.sessions.get(document)
        if (session) this.refresh(session)
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        const session = this.sessions.get(document)
        if (session) this.invalidate(session)
      }),
      vscode.workspace.onDidRenameFiles(({ files }) => this.invalidateResources(files.map(file => file.oldUri))),
      vscode.workspace.onDidDeleteFiles(({ files }) => this.invalidateResources(files)),
    ]
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken) {
    panel.webview.options = { enableScripts: true, enableForms: false, localResourceRoots: [this.assetsRoot] }
    const html = await webviewHtml(panel.webview, this.assetsRoot)
    if (token.isCancellationRequested) return
    const session = this.sessions.get(document) ?? this.createSession(document)
    const view: View = { panel, ready: false, disposed: false, lastEdit: -1, subscriptions: [] }
    session.views.add(view)
    view.subscriptions = [
      panel.onDidDispose(() => this.removeView(session, view)),
      panel.onDidChangeViewState(() => {
        if (panel.visible && view.ready && session.pending?.view !== view) {
          if (view.undelivered) this.post(view, view.undelivered)
          this.sendState(view, session.state)
        }
      }),
      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (view.disposed || !isClientMessage(message) || (!view.ready && message.type !== 'ready')) return
        session.queued++
        session.operations = session.operations.then(() => this.receive(session, view, message)).catch(() => {
          if (message.type === 'edit') this.acknowledge(view, session.state, message.id, false, 'VS Code could not apply this edit.')
          else this.post(view, { type: 'error', message: 'VS Code could not complete this operation.' })
        }).finally(() => {
          session.queued--
          this.releaseIdleSession(session)
        })
      }),
    ]
    panel.webview.html = html
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.dispose()
    for (const session of this.sessions.values()) for (const view of session.views) this.removeView(session, view)
  }

  private createSession(document: vscode.TextDocument): Session {
    const session: Session = { document, state: documentState(document, !document.isClosed), views: new Set(), operations: Promise.resolve(), queued: 0 }
    this.sessions.set(document, session)
    if (!document.isUntitled && vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) !== undefined) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), '*'))
      const verify = (uri: vscode.Uri) => {
        if (within(document.uri, uri)) void this.verifyFile(session).catch(() => undefined)
      }
      session.watcher = vscode.Disposable.from(watcher, watcher.onDidDelete(verify), watcher.onDidChange(verify))
    }
    return session
  }

  private removeView(session: Session, view: View) {
    if (view.disposed) return
    view.disposed = true
    for (const subscription of view.subscriptions) subscription.dispose()
    session.views.delete(view)
    this.releaseIdleSession(session)
  }

  private releaseIdleSession(session: Session) {
    if (session.views.size || session.queued) return
    session.watcher?.dispose()
    this.sessions.delete(session.document)
  }

  private async verifyFile(session: Session) {
    const { document } = session
    if (!session.state.available) return false
    if (document.isClosed) {
      this.invalidate(session)
      return false
    }
    if (document.isUntitled || vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === undefined) return true
    try {
      const file = await vscode.workspace.fs.stat(document.uri)
      if (!(file.type & vscode.FileType.File)) this.invalidate(session)
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error
      this.invalidate(session)
    }
    return session.state.available
  }

  private invalidateResources(resources: readonly vscode.Uri[]) {
    for (const session of this.sessions.values()) {
      if (resources.some(resource => within(session.document.uri, resource))) this.invalidate(session)
    }
  }

  private invalidate(session: Session) {
    if (!session.state.available) return
    session.state = { ...session.state, available: false }
    this.broadcast(session)
  }

  private refresh(session: Session) {
    if (!session.state.available) return
    const next = documentState(session.document, !session.document.isClosed)
    const previous = session.state
    if (previous.revision === next.revision && previous.dirty === next.dirty && previous.available === next.available && previous.eol === next.eol) return
    session.state = next
    if (session.pending?.expected === next.source && next.available) session.pending.committed ??= next
    this.broadcast(session)
  }

  private broadcast(session: Session) {
    for (const view of session.views) if (session.pending?.view !== view) this.sendState(view, session.state)
  }

  private post(view: View, message: HostMessage) {
    if (!view.ready || view.disposed) return
    if (message.type === 'state' && message.edit) view.undelivered = message
    void Promise.resolve(view.panel.webview.postMessage(message)).then(delivered => {
      if (delivered && view.undelivered === message) view.undelivered = undefined
    }, () => undefined)
  }

  private sendState(view: View, state: DocumentState) { this.post(view, { type: 'state', state }) }

  private acknowledge(view: View, state: DocumentState, id: number, accepted: boolean, message?: string) {
    this.post(view, { type: 'state', state, edit: { id, accepted, message } })
  }

  private async receive(session: Session, view: View, message: ClientMessage) {
    // A received edit belongs to the live document even if its panel is closed before the queue drains.
    if (message.type === 'edit') return this.apply(session, view, message)
    if (view.disposed) return
    if (message.type === 'ready') {
      view.ready = true
      view.lastEdit = -1
      view.undelivered = undefined
      try { await this.verifyFile(session) } catch { /* A transient file check must not prevent opening the document. */ }
      this.sendState(view, session.state)
    } else await this.command(session, view, message)
  }

  private async apply(session: Session, view: View, { id, revision, change }: EditMessage) {
    const reject = (message: string) => this.acknowledge(view, session.state, id, false, message)
    if (id <= view.lastEdit) return reject(stale)
    view.lastEdit = id
    if (!await this.verifyFile(session)) return reject(unavailable)
    const { document } = session
    if (!session.state.available || document.isClosed) return reject(unavailable)
    const base = documentState(document, true)
    session.state = base
    if (base.revision !== revision) return reject(stale)
    if (change.to > base.source.length) return reject('The edit range is invalid.')
    const expected = spliceSource(base.source, change)
    if (expected === base.source) return reject('This edit did not change the document.')

    const edit = new vscode.WorkspaceEdit()
    edit.replace(document.uri, new vscode.Range(position(base.source, change.from), position(base.source, change.to)), change.text.replace(/\n/g, base.eol))
    const pending: NonNullable<Session['pending']> = { view, expected }
    session.pending = pending
    let applied: boolean
    try {
      // Apply immediately after checking the version so VS Code can enforce the same base version.
      applied = await vscode.workspace.applyEdit(edit)
    } catch { applied = false }
    finally {
      try { this.refresh(session) } finally { session.pending = undefined }
    }

    if (!applied || !pending.committed) {
      if (!session.state.available) return reject(unavailable)
      return reject(session.state.revision === revision ? 'VS Code could not apply this edit.' : stale)
    }
    this.acknowledge(view, pending.committed, id, true)
    if (session.state !== pending.committed) this.sendState(view, session.state)
  }

  private async command(session: Session, view: View, { command, text }: CommandMessage) {
    if (command === 'copy') {
      if (typeof text === 'string') await vscode.env.clipboard.writeText(text)
      return
    }
    if (!await this.verifyFile(session) || !session.state.available || session.document.isClosed) this.post(view, { type: 'error', message: unavailable })
    else if (view.disposed) return
    else if (command === 'save') {
      if (!await session.document.save()) this.post(view, { type: 'error', message: 'VS Code could not save this document.' })
      this.refresh(session)
    } else {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      if (view.panel.active && input instanceof vscode.TabInputCustom && input.viewType === viewType && input.uri.toString() === session.state.uri) {
        await vscode.commands.executeCommand(command)
      } else this.post(view, { type: 'error', message: 'Focus this editor to use its undo or redo history.' })
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new FolioEditorProvider(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'))
  context.subscriptions.push(provider, vscode.window.registerCustomEditorProvider(viewType, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  }))
}
