import { createHash, randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { connectionMessage, isClientMessage, spliceSource, type ClientMessage, type DocumentState, type HostMessage } from '../../src/host/vscode/protocol'
import { isId, isRecoveryDraft, recoveryPrefix, type RecoveryDraft } from '../../src/host/vscode/recovery'
import { webviewHtml } from './webview'

const viewType = 'folio.markdown'
const unavailable = 'This document was moved, deleted, or closed. Reopen it from VS Code to continue.'
const stale = 'The document changed in VS Code before this edit could be applied.'

type StateMessage = Extract<HostMessage, { type: 'state' }>
type EditMessage = Extract<ClientMessage, { type: 'edit' }>
type CommandMessage = Extract<ClientMessage, { type: 'command' }>

interface View {
  panel: vscode.WebviewPanel
  disposed: boolean
  client?: Client
  subscriptions: vscode.Disposable[]
}

interface Client {
  connection: string
  journalId: string
  lastEdit: number
  abandoned: number
  generation: number
  acknowledgement?: StateMessage
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
    bom: document.encoding === 'utf8bom' || document.encoding === 'utf16le' || document.encoding === 'utf16be',
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
  private readonly activeJournals = new Set<string>()
  private readonly subscriptions: vscode.Disposable[]

  constructor(private readonly assetsRoot: vscode.Uri, private readonly recovery: vscode.Memento, private readonly scope: string) {
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
    const view: View = { panel, disposed: false, subscriptions: [] }
    session.views.add(view)
    view.subscriptions = [
      panel.onDidDispose(() => this.removeView(session, view)),
      panel.onDidChangeViewState(() => {
        if (panel.visible) this.sendStatus(session, view)
      }),
      panel.webview.onDidReceiveMessage((incoming: unknown) => {
        const envelope = connectionMessage(incoming, isClientMessage)
        if (view.disposed || !envelope) return
        const { connection, message } = envelope
        if (message.type === 'ready') {
          if (view.client?.connection !== connection) {
            if (view.client) this.activeJournals.delete(view.client.journalId)
            view.client = { connection, journalId: randomUUID(), lastEdit: 0, abandoned: 0, generation: 0 }
            this.activeJournals.add(view.client.journalId)
          }
          this.sendStatus(session, view)
          void this.verifyFile(session).catch(() => undefined)
          return
        }
        const client = view.client
        if (!client || client.connection !== connection) return
        if (message.type === 'status') return this.sendStatus(session, view)
        if (message.type === 'abandon') {
          client.abandoned = Math.max(client.abandoned, message.id)
          this.sendStatus(session, view)
          return
        }
        if (message.type === 'checkpoint') return void this.checkpoint(session, view, client, message.draft)
        if (message.type === 'dismiss') return void this.dismiss(view, client, message)
        if (message.type === 'copy') {
          const { id, text } = message
          void vscode.env.clipboard.writeText(text).then(
            () => this.post(view, { type: 'copied', id, copied: true }, client),
            () => this.post(view, { type: 'copied', id, copied: false }, client),
          )
          return
        }
        session.queued++
        session.operations = session.operations.then(() => {
          if (view.client !== client) return
          // Received edits may finish even if the panel closes while the document stays open.
          if (message.type === 'edit') return this.apply(session, view, client, message)
          if (!view.disposed) return this.command(session, view, client, message)
        }).catch(() => {
          if (message.type === 'edit') this.acknowledge(view, client, session.state, message.id, false, 'VS Code could not apply this edit.')
          else this.post(view, { type: 'error', message: 'VS Code could not complete this operation.' }, client)
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
    if (view.client) this.activeJournals.delete(view.client.journalId)
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
    if (previous.revision === next.revision && previous.dirty === next.dirty && previous.available === next.available &&
      previous.eol === next.eol && previous.bom === next.bom) return
    session.state = next
    if (session.pending?.expected === next.source && next.available) session.pending.committed ??= next
    this.broadcast(session)
  }

  private broadcast(session: Session) {
    for (const view of session.views) if (session.pending?.view !== view) this.sendState(view, session.state)
  }

  private post(view: View, message: HostMessage, client = view.client) {
    if (!client || view.client !== client || view.disposed) return
    void Promise.resolve(view.panel.webview.postMessage({ connection: client.connection, message })).catch(() => undefined)
  }

  private sendState(view: View, state: DocumentState) { this.post(view, { type: 'state', state }) }

  private acknowledge(view: View, client: Client, state: DocumentState, id: number, accepted: boolean, message?: string) {
    const reply: StateMessage = { type: 'state', state, edit: { id, accepted, message } }
    client.acknowledgement = reply
    this.post(view, reply, client)
  }

  private sendStatus(session: Session, view: View) {
    const client = view.client
    if (!client || view.disposed) return
    const drafts: RecoveryDraft[] = []
    for (const key of this.recovery.keys()) {
      if (!key.startsWith(recoveryPrefix) || this.activeJournals.has(key.slice(recoveryPrefix.length))) continue
      const draft = this.recovery.get(key)
      if (isRecoveryDraft(draft) && key === recoveryPrefix + draft.id) drafts.push(draft)
    }
    this.post(view, { type: 'recovery', scope: this.scope, id: client.journalId, active: [...this.activeJournals], drafts })
    if (client.acknowledgement) this.post(view, client.acknowledgement)
    if (session.pending?.view !== view) this.sendState(view, session.state)
  }

  private async checkpoint(session: Session, view: View, client: Client, draft: RecoveryDraft) {
    const { id, uri, generation } = draft
    if (id !== client.journalId || uri !== session.state.uri || generation <= client.generation) return
    client.generation = generation
    let stored = false
    try {
      await this.recovery.update(recoveryPrefix + id, draft)
      stored = true
    } catch { /* This generation may still be recoverable from webview storage. */
    } finally {
      this.post(view, { type: 'stored', id, generation, stored }, client)
    }
  }

  private async dismiss(view: View, client: Client, { id, generation }: Extract<ClientMessage, { type: 'dismiss' }>) {
    if (id !== client.journalId && this.activeJournals.has(id)) {
      this.post(view, { type: 'dismissed', id, generation, dismissed: false }, client)
      return
    }
    const key = recoveryPrefix + id
    const current = this.recovery.get(key)
    let dismissed = false
    try {
      if (isRecoveryDraft(current) && current.generation > generation) return
      if (id === client.journalId) client.generation = Math.max(client.generation, generation)
      if (current !== undefined) await this.recovery.update(key, undefined)
      dismissed = true
    } catch { /* The webview retains its recovery copy on failure. */ }
    finally { this.post(view, { type: 'dismissed', id, generation, dismissed }, client) }
  }

  private async apply(session: Session, view: View, client: Client, { id, revision, change }: EditMessage) {
    const reject = (message: string) => this.acknowledge(view, client, session.state, id, false, message)
    if (id <= client.lastEdit) {
      if (client.acknowledgement?.edit?.id === id) this.post(view, client.acknowledgement, client)
      return
    }
    client.lastEdit = id
    if (id <= client.abandoned) return reject('This Folio edit expired before it reached VS Code.')
    if (!await this.verifyFile(session)) return reject(unavailable)
    if (id <= client.abandoned || view.client !== client) return reject('This Folio edit expired before it reached VS Code.')
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
    this.acknowledge(view, client, pending.committed, id, true)
    if (session.state !== pending.committed || id <= client.abandoned) this.sendState(view, session.state)
  }

  private async command(session: Session, view: View, client: Client, { command }: CommandMessage) {
    const available = await this.verifyFile(session)
    if (view.disposed || view.client !== client) return
    if (!available || !session.state.available || session.document.isClosed) this.post(view, { type: 'error', message: unavailable }, client)
    else if (command === 'save') {
      if (!await session.document.save()) this.post(view, { type: 'error', message: 'VS Code could not save this document.' }, client)
      this.refresh(session)
    } else {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      if (view.panel.active && input instanceof vscode.TabInputCustom && input.viewType === viewType && input.uri.toString() === session.state.uri) {
        await vscode.commands.executeCommand(command)
      } else this.post(view, { type: 'error', message: 'Focus this editor to use its undo or redo history.' }, client)
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  let workspace = context.storageUri?.toString()
  if (!workspace) {
    // Empty windows have workspace state but no extension storage directory.
    const key = 'folio.emptyWindowScope'
    const existing = context.workspaceState.get(key)
    workspace = isId(existing) ? existing : randomUUID()
    if (workspace !== existing) {
      try { await context.workspaceState.update(key, workspace) } catch { /* Use a session-local scope if persistence fails. */ }
    }
  }
  const scope = createHash('sha256').update(workspace).digest('hex')
  const provider = new FolioEditorProvider(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'), context.workspaceState, scope)
  context.subscriptions.push(provider, vscode.window.registerCustomEditorProvider(viewType, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  }))
}
