import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { docxMaxFileBytes, docxMaxWorkspaceSnapshot, readDocxSnapshot } from '../../src/document/formats/docx/model'
import { connectionMessage, isClientMessage, sourceChange, spliceSource, type ClientMessage, type DocumentState, type HostMessage } from '../../src/host/vscode/protocol'
import { isRecoveryDraft, recoveryPrefix, type RecoveryDraft } from '../../src/host/vscode/recovery'
import { cancellation, DocxDocument, docxCopyNotice, docxExternalNotice, fingerprint, loadDocxPackage, restoreDocxBackup, retireDocxBackup, writeDocxBackup } from './docxDocument'
import { isLocalDocumentFile, readLocalDocument } from './localDocumentFile'
import { runDocxWorker } from './docxWorker'
import { webviewHtml } from './webview'

export const docxViewType = 'folio.docx'
const prefix = recoveryPrefix + 'docx.'
const stale = 'The DOCX changed. Start again from the current revision.'
const copyRequired = 'This DOCX opens as an editable draft. Use Export DOCX copy in Folio to review changes and save a separate file.'

type Edit = Extract<ClientMessage, { type: 'edit' }>
type FileRequest = Extract<ClientMessage, { type: 'docxFile' }>
type Ack = Extract<HostMessage, { type: 'accepted' | 'state' }>

interface Client {
  connection: string
  journalId: string
  generation: number
  lastEdit: number
  abandoned: number
  editing?: boolean
  acknowledgement?: Ack
  request?: { id: number; controller: AbortController }
}

interface View {
  panel: vscode.WebviewPanel
  client?: Client
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 1024) : 'VS Code could not complete this DOCX operation.'

export class DocxEditorProvider implements vscode.CustomEditorProvider<DocxDocument> {
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<DocxDocument>>()
  private readonly views = new Map<DocxDocument, View>()
  private readonly activeJournals = new Set<string>()
  readonly onDidChangeCustomDocument = this.changed.event

  constructor(private readonly assets: vscode.Uri, private readonly recovery: vscode.Memento, private readonly scope: string,
    private readonly backupRoot: vscode.Uri) {}

  dispose() {
    this.changed.dispose()
    for (const document of this.views.keys()) document.dispose()
  }

  async openCustomDocument(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken) {
    const document = new DocxDocument(uri)
    const { signal, dispose } = cancellation(token)
    try {
      if (!vscode.workspace.isTrusted || !isLocalDocumentFile(uri)) {
        throw new Error('Folio DOCX requires a trusted workspace and a local file. Open this document in a dedicated Word editor.')
      }
      if (context.backupId) {
        await restoreDocxBackup(document, context.backupId, this.backupRoot, signal)
        const checkpoint = this.recovery.get(prefix + document.journalId)
        if (isRecoveryDraft(checkpoint) && (checkpoint.generation > document.revision || checkpoint.source !== document.source)) {
          // Native hot-exit backup can lag the independent, acknowledged workspace checkpoint.
          document.journalId = randomUUID()
        }
        document.revision++
        await this.checkExternal(document, signal)
      } else document.install(await loadDocxPackage(uri, signal))
    } catch (error) {
      signal.throwIfAborted()
      // A failed hot-exit restore must stay retryable. VS Code still owns its backup id.
      if (context.backupId) throw error
      document.failure = 'Folio could not open this DOCX for editing. ' + errorMessage(error)
    } finally { dispose() }
    return document
  }

  async resolveCustomEditor(document: DocxDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken) {
    panel.webview.options = { enableScripts: true, enableForms: false, localResourceRoots: [this.assets] }
    const html = await webviewHtml(panel.webview, this.assets, 'DOCX')
    if (token.isCancellationRequested) return
    const view: View = { panel }
    this.views.set(document, view)
    this.activeJournals.add(document.journalId)
    let timer: ReturnType<typeof setTimeout> | undefined
    const verify = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void this.checkExternal(document, document.lifetime.signal) }, 200)
    }
    const path = vscode.Uri.joinPath(document.uri, '..')
    const watcher = document.original && vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path, '*'))
    if (watcher) {
      for (const watch of [watcher.onDidChange, watcher.onDidCreate, watcher.onDidDelete]) {
        watch(uri => { if (uri.toString().toLowerCase() === document.uri.toString().toLowerCase()) verify() })
      }
    }
    const visibility = panel.onDidChangeViewState(() => { if (panel.active && document.original) verify() })
    const listener = panel.webview.onDidReceiveMessage((incoming: unknown) => {
      const envelope = connectionMessage(incoming, isClientMessage)
      if (!envelope) return
      const { connection, message } = envelope
      if (message.type === 'ready') {
        if (view.client?.connection !== connection) {
          this.disconnect(view)
          view.client = { connection, journalId: randomUUID(), generation: 0, lastEdit: 0, abandoned: 0 }
          this.activeJournals.add(view.client.journalId)
        }
        if (document.fromBackup && document.original) {
          document.fromBackup = false
          this.emitHistory(document, document.original.source, document.source, false, 'Recover DOCX draft')
        }
        this.sendStatus(document, view, view.client)
        if (document.original) verify()
        return
      }
      const client = view.client
      if (!client || client.connection !== connection) return
      if (message.type === 'status') return this.sendStatus(document, view, client)
      if (message.type === 'abandon') {
        client.abandoned = Math.max(client.abandoned, message.id)
        return this.sendStatus(document, view, client)
      }
      if (message.type === 'cancelDocxFile') {
        if (client.request?.id === message.id) client.request.controller.abort()
        return
      }
      if (message.type === 'docxFile') return void this.deliver(document, view, client, message)
      if (message.type === 'copy') {
        const { id, text } = message
        if (text.length > docxMaxWorkspaceSnapshot) return this.post(view, client, { type: 'copied', id, copied: false })
        void vscode.env.clipboard.writeText(text).then(
          () => this.post(view, client, { type: 'copied', id, copied: true }),
          () => this.post(view, client, { type: 'copied', id, copied: false }),
        )
        return
      }
      if (message.type === 'checkpoint' || message.type === 'dismiss' || message.type === 'edit') {
        void this.receiveEdit(document, view, client, message)
      }
      if (message.type === 'command' && panel.active && document.original) {
        if (message.command === 'save') this.post(view, client, { type: 'error', message: copyRequired })
        else if (message.command === 'revert' && !document.dirty) void this.revert(document, document.lifetime.signal).catch(() => undefined)
        else void Promise.resolve(vscode.commands.executeCommand(message.command === 'revert' ? 'workbench.action.files.revert' : message.command)).catch(error => {
          this.post(view, client, { type: 'error', message: errorMessage(error) })
        })
      }
    })
    panel.onDidDispose(() => {
      clearTimeout(timer)
      if (watcher) watcher.dispose()
      listener.dispose()
      visibility.dispose()
      this.disconnect(view)
      if (this.views.get(document) === view) this.views.delete(document)
      this.activeJournals.delete(document.journalId)
    })
    panel.webview.html = html
  }

  private disconnect(view: View) {
    if (!view.client) return
    view.client.request?.controller.abort()
    this.activeJournals.delete(view.client.journalId)
    view.client = undefined
  }

  private state(document: DocxDocument): DocumentState {
    const notice = document.external ? docxExternalNotice : docxCopyNotice
    return {
      uri: document.uri.toString(), title: document.uri.path.split('/').at(-1) || 'DOCX',
      source: document.source, revision: document.revision, dirty: document.dirty, available: !!document.rich,
      eol: '\n', format: 'docx', issues: document.original?.issues, readOnly: document.failure,
      originalFingerprint: document.original?.fingerprint,
      notice: document.failure ? undefined : document.revertError ? notice + ' ' + document.revertError : notice,
    }
  }

  private post(view: View, client: Client, message: HostMessage) {
    if (view.client === client) void Promise.resolve(view.panel.webview.postMessage({ connection: client.connection, message })).catch(() => undefined)
  }

  private publish(document: DocxDocument) {
    const view = this.views.get(document)
    if (view?.client) this.post(view, view.client, { type: 'state', state: this.state(document) })
  }

  private sendStatus(document: DocxDocument, view: View, client: Client) {
    const drafts: RecoveryDraft[] = []
    let remaining = 3 * docxMaxWorkspaceSnapshot
    for (const key of [...this.recovery.keys()].reverse()) {
      if (!key.startsWith(prefix) || this.activeJournals.has(key.slice(prefix.length))) continue
      const entry = this.recovery.get(key)
      if (!isRecoveryDraft(entry) || entry.uri !== document.uri.toString() || key !== prefix + entry.id) continue
      const length = entry.source.length + (entry.native?.source.length ?? 0)
      if (length > remaining || drafts.length >= 16) continue
      remaining -= length
      drafts.push(entry)
    }
    this.post(view, client, { type: 'recovery', scope: this.scope, id: client.journalId, active: [...this.activeJournals], drafts })
    if (client.acknowledgement) this.post(view, client, client.acknowledgement)
    this.post(view, client, { type: 'state', state: this.state(document) })
  }

  private async receiveEdit(document: DocxDocument, view: View, client: Client, message: Extract<ClientMessage, { type: 'checkpoint' | 'dismiss' | 'edit' }>) {
    if (message.type === 'checkpoint') {
      const { draft } = message
      if (!isRecoveryDraft(draft) || draft.id !== client.journalId || draft.uri !== document.uri.toString() ||
        draft.generation <= client.generation) return
      client.generation = draft.generation
      let stored = false
      try {
        readDocxSnapshot(draft.source)
        if (draft.native) readDocxSnapshot(draft.native.source)
        await this.recovery.update(prefix + draft.id, draft)
        stored = true
      } catch { /* Retain the independent webview journal. */ }
      this.post(view, client, { type: 'stored', id: draft.id, generation: draft.generation, stored })
    } else if (message.type === 'dismiss') {
      const { id, generation } = message
      let dismissed = false
      try {
        const current = this.recovery.get(prefix + id)
        const own = id === client.journalId
        if (own ? client.generation > generation : this.activeJournals.has(id)) return
        if (isRecoveryDraft(current) && (current.uri !== document.uri.toString() || current.generation > generation)) return
        if (own) client.generation = generation
        if (current !== undefined) await this.recovery.update(prefix + id, undefined)
        dismissed = true
      } catch { /* Retain the independent webview journal. */ }
      finally { this.post(view, client, { type: 'dismissed', id, generation, dismissed }) }
    } else {
      if (client.editing) return
      client.editing = true
      try { await document.serialize(() => this.edit(document, view, client, message)) }
      finally { client.editing = false }
    }
  }

  private async commit(document: DocxDocument, source: string, dirty: boolean) {
    const rich = readDocxSnapshot(source)
    document.lifetime.signal.throwIfAborted()
    const revision = document.revision + 1
    const record: RecoveryDraft | undefined = dirty
      ? { id: document.journalId, uri: document.uri.toString(), generation: revision, source, eol: '\n', bom: false,
        reason: 'interrupted', originalFingerprint: document.original?.fingerprint }
      : undefined
    await this.recovery.update(prefix + document.journalId, record)
    document.source = source
    document.rich = rich
    document.revision = revision
    document.dirty = dirty
  }

  private async edit(document: DocxDocument, view: View, client: Client, { id, revision, change }: Edit) {
    if (view.client !== client) return
    if (id <= client.lastEdit) {
      if (client.acknowledgement?.edit?.id === id) this.post(view, client, client.acknowledgement)
      return
    }
    client.lastEdit = id
    const reject = (message: string) => {
      const reply: Ack = { type: 'state', state: this.state(document), edit: { id, accepted: false, message } }
      client.acknowledgement = reply
      this.post(view, client, reply)
    }
    try {
      if (!document.rich || id <= client.abandoned || revision !== document.revision) return reject(stale)
      const before = document.source
      if (change.to > before.length || before.length - (change.to - change.from) + change.text.length > docxMaxWorkspaceSnapshot) {
        return reject('The DOCX edit range or size is outside Folio’s workspace limits.')
      }
      const after = spliceSource(before, change)
      if (before === after) return reject('This DOCX edit did not change the document.')
      const wasDirty = document.dirty
      await this.commit(document, after, true)
      this.emitHistory(document, before, after, wasDirty, 'Edit DOCX')
      const { source: _verified, ...metadata } = this.state(document)
      const reply: Ack = { type: 'accepted', state: metadata, edit: { id } }
      client.acknowledgement = reply
      this.post(view, client, reply)
      if (view.client !== client) this.publish(document)
    } catch (error) { reject(errorMessage(error)) }
  }

  private emitHistory(document: DocxDocument, before: string, after: string, wasDirty: boolean, label: string) {
    const forward = sourceChange(before, after)
    const reverse = sourceChange(after, before)
    if (!forward || !reverse) return
    const epoch = document.historyEpoch
    const beforeFingerprint = fingerprint(before)
    const afterFingerprint = fingerprint(after)
    // Native history holds inverse ranges rather than a full package per transaction.
    const history = (patch: typeof forward, expected: string, dirty: boolean) => document.serialize(async () => {
      if (document.historyEpoch !== epoch || fingerprint(document.source) !== expected) {
        void vscode.window.showErrorMessage('Folio kept the DOCX draft because the native history entry was stale.')
        throw new Error(stale)
      }
      await this.commit(document, spliceSource(document.source, patch), dirty)
      this.publish(document)
    })
    this.changed.fire({ document, label, undo: () => history(reverse, afterFingerprint, wasDirty), redo: () => history(forward, beforeFingerprint, true) })
  }

  private async checkExternal(document: DocxDocument, signal: AbortSignal) {
    const original = document.original
    if (!original || signal.aborted) return
    let changed: boolean
    try { changed = fingerprint(await readLocalDocument(document.uri, docxMaxFileBytes, signal)) !== original.fingerprint }
    catch { changed = true }
    if (signal.aborted || original !== document.original || changed === document.external) return
    document.external = changed
    this.publish(document)
  }

  private async deliver(document: DocxDocument, view: View, client: Client, { id, revision, kind }: FileRequest) {
    const reply = (result: { bytes: ArrayBuffer } | { error: string }) => this.post(view, client, { type: 'docxFileResult', id, ...result })
    if (client.request) return reply({ error: 'A DOCX download is already being prepared.' })
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, document.lifetime.signal])
    client.request = { id, controller }
    try {
      if (!document.original || !document.rich) throw new Error('The DOCX document is unavailable.')
      if (!view.panel.active || document.revision !== revision) throw new Error(stale)
      const bytes = kind === 'original' ? document.original.bytes
        : (await runDocxWorker({ operation: 'write', document: document.rich }, signal)).bytes
      signal.throwIfAborted()
      if (document.revision !== revision) throw new Error(stale)
      // vscode.postMessage transports ArrayBuffers without JSON expansion.
      reply({ bytes: bytes.slice().buffer })
    } catch (error) {
      if (!signal.aborted) reply({ error: errorMessage(error) })
    } finally { if (client.request?.id === id) client.request = undefined }
  }

  async saveCustomDocument(document: DocxDocument, token: vscode.CancellationToken) {
    this.rejectSave(document, token)
  }

  async saveCustomDocumentAs(document: DocxDocument, _destination: vscode.Uri, token: vscode.CancellationToken) {
    this.rejectSave(document, token)
  }

  private rejectSave(document: DocxDocument, token: vscode.CancellationToken): never {
    if (token.isCancellationRequested) throw new vscode.CancellationError()
    const view = this.views.get(document)
    if (view?.client) this.post(view, view.client, { type: 'error', message: copyRequired })
    throw new Error(copyRequired)
  }

  revertCustomDocument(document: DocxDocument, token: vscode.CancellationToken) {
    const { signal, dispose } = cancellation(token, document.lifetime.signal)
    return this.revert(document, signal).finally(dispose)
  }

  private revert(document: DocxDocument, signal: AbortSignal) {
    return document.serialize(async () => {
      try {
        const original = await loadDocxPackage(document.uri, signal)
        signal.throwIfAborted()
        await this.recovery.update(prefix + document.journalId, undefined)
        document.install(original)
        document.dirty = false
        document.external = false
        document.revision++
        document.historyEpoch++
        this.publish(document)
        await retireDocxBackup(document)
      } catch (error) {
        if (document.lifetime.signal.aborted) throw error
        // VS Code clears custom editor history before the asynchronous provider revert returns.
        if (document.dirty && document.original) {
          document.historyEpoch++
          this.emitHistory(document, document.original.source, document.source, false, 'Preserve DOCX draft after failed revert')
        }
        document.revertError = 'Folio kept the DOCX draft because it could not revert. ' + errorMessage(error)
        this.publish(document)
        // VS Code retires the active backup when the provider reports success.
        throw error
      }
    })
  }

  backupCustomDocument(document: DocxDocument, { destination }: vscode.CustomDocumentBackupContext, token: vscode.CancellationToken) {
    const { signal, dispose } = cancellation(token, document.lifetime.signal)
    return document.serialize(() => writeDocxBackup(document, destination, signal)).finally(dispose)
  }
}
