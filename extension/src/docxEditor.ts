import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { docxMaxFileBytes, docxMaxWorkspaceSnapshot, readDocxSnapshot } from '../../src/document/formats/docx/model'
import { connectionMessage, isClientMessage, sourceChange, spliceSource, type ClientMessage, type DocumentState, type HostMessage } from '../../src/host/vscode/protocol'
import { isRecoveryDraft, recoveryPrefix, type RecoveryDraft } from '../../src/host/vscode/recovery'
import { BinarySaveError, externalRefusal, interruptedNotice, saveUnavailable, type BinarySaver } from './binarySave'
import { cancellation, DocxDocument, docxExternalNotice, fingerprint, importPackage, loadDocxPackage, restoreDocxBackup, retireDocxBackup, writeDocxBackup } from './docxDocument'
import { isLocalDocumentFile, readLocalDocument } from './localDocumentFile'
import { isSameSpreadsheetFile as isSameFile } from './spreadsheetCopy'
import { runDocxWorker } from './docxWorker'
import { attachAppearance } from './appearance'
import { webviewHtml } from './webview'
import { savePdfCopy } from './pdfCopy'

export const docxViewType = 'folio.docx'
const prefix = recoveryPrefix + 'docx.'
const stale = 'The DOCX changed. Start again from the current revision.'
const copyRequired = saveUnavailable('DOCX')
const journalConflict = 'An earlier Folio save of this DOCX was interrupted and the file changed afterwards. Folio opened the current file and kept the save journal.'

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
  pdfExport?: number
}

interface View {
  panel: vscode.WebviewPanel
  client?: Client
}

function docxLosses(issues: { feature: string; location?: string; effect: string }[]) {
  return [...new Set(issues.filter(issue => issue.effect !== 'preserved').map(issue => issue.feature + (issue.location ? ` (${issue.location})` : '')))]
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 1024) : 'VS Code could not complete this DOCX operation.'

export class DocxEditorProvider implements vscode.CustomEditorProvider<DocxDocument> {
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<DocxDocument>>()
  private readonly views = new Map<DocxDocument, View>()
  private readonly activeJournals = new Set<string>()
  readonly onDidChangeCustomDocument = this.changed.event

  constructor(private readonly assets: vscode.Uri, private readonly recovery: vscode.Memento, private readonly scope: string,
    private readonly backupRoot: vscode.Uri, private readonly saver: BinarySaver) {}

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
      } else {
        const bytes = await readLocalDocument(uri, docxMaxFileBytes, signal)
        const journal = await this.saver.recover(uri, bytes)
        if (journal?.state === 'interrupted') {
          // Reopen the last complete file as the original and the content being saved as an unsaved draft.
          const previous = await importPackage(journal.journal.previous, signal)
          const draft = await importPackage(journal.journal.replacement, signal)
          document.install(previous, draft.source, draft.document)
          document.disk = journal.disk
          document.dirty = document.fromBackup = true
          document.saveNotice = interruptedNotice('DOCX')
        } else {
          document.install(await importPackage(bytes, signal))
          if (journal) document.saveNotice = journalConflict
        }
      }
      document.nativeSave = await this.saver.available(uri)
    } catch (error) {
      signal.throwIfAborted()
      // A failed hot-exit restore must stay retryable. VS Code still owns its backup id.
      if (context.backupId) throw error
      document.failure = 'Folio could not open this DOCX for editing. ' + errorMessage(error)
    } finally { dispose() }
    return document
  }

  async resolveCustomEditor(document: DocxDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken) {
    panel.webview.options = { enableScripts: true, enableForms: true, localResourceRoots: [this.assets] }
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
          this.emitHistory(document, document.original.source, document.source, 'Recover DOCX draft')
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
      if (message.type === 'pdfExport') return void this.exportPdf(document, view, client, message)
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
        if (message.command === 'save' && !document.nativeSave) this.post(view, client, { type: 'error', message: copyRequired })
        else if (message.command === 'save') void Promise.resolve(vscode.commands.executeCommand('workbench.action.files.save')).catch(() => undefined)
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
    attachAppearance(panel)
    panel.webview.html = html
  }

  private disconnect(view: View) {
    if (!view.client) return
    view.client.request?.controller.abort()
    this.activeJournals.delete(view.client.journalId)
    view.client = undefined
  }

  private state(document: DocxDocument): DocumentState {
    const notice = [document.external ? docxExternalNotice : undefined, document.saveNotice,
      document.nativeSave || document.failure ? undefined : copyRequired, document.revertError].filter(Boolean).join(' ')
    return {
      uri: document.uri.toString(), title: document.uri.path.split('/').at(-1) || 'DOCX',
      source: document.source, revision: document.revision, dirty: document.dirty, available: !!document.rich,
      eol: '\n', format: 'docx', issues: document.original?.issues, readOnly: document.failure,
      originalFingerprint: document.original?.fingerprint, nativeSave: document.nativeSave,
      notice: document.failure || !notice ? undefined : notice,
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

  private async commit(document: DocxDocument, source: string) {
    const rich = readDocxSnapshot(source)
    document.lifetime.signal.throwIfAborted()
    const revision = document.revision + 1
    // Dirty state follows content, so undoing past a save keeps a recovery checkpoint for a draft that differs from disk.
    const dirty = source !== document.clean || document.disk !== document.original?.fingerprint
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
      await this.commit(document, after)
      this.emitHistory(document, before, after, 'Edit DOCX')
      const { source: _verified, ...metadata } = this.state(document)
      const reply: Ack = { type: 'accepted', state: metadata, edit: { id } }
      client.acknowledgement = reply
      this.post(view, client, reply)
      if (view.client !== client) this.publish(document)
    } catch (error) { reject(errorMessage(error)) }
  }

  private emitHistory(document: DocxDocument, before: string, after: string, label: string) {
    const forward = sourceChange(before, after)
    const reverse = sourceChange(after, before)
    if (!forward || !reverse) return
    const epoch = document.historyEpoch
    const beforeFingerprint = fingerprint(before)
    const afterFingerprint = fingerprint(after)
    // Native history holds inverse ranges rather than a full package per transaction.
    const history = (patch: typeof forward, expected: string) => document.serialize(async () => {
      if (document.historyEpoch !== epoch || fingerprint(document.source) !== expected) {
        void vscode.window.showErrorMessage('Folio kept the DOCX draft because the native history entry was stale.')
        throw new Error(stale)
      }
      await this.commit(document, spliceSource(document.source, patch))
      this.publish(document)
    })
    this.changed.fire({ document, label, undo: () => history(reverse, afterFingerprint), redo: () => history(forward, beforeFingerprint) })
  }

  private async checkExternal(document: DocxDocument, signal: AbortSignal) {
    const original = document.original
    if (!original || signal.aborted) return
    let changed: boolean
    try { changed = fingerprint(await readLocalDocument(document.uri, docxMaxFileBytes, signal)) !== (document.disk ?? original.fingerprint) }
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

  /** Saves a reviewed PDF copy of the current draft revision without touching the DOCX. */
  private async exportPdf(document: DocxDocument, view: View, client: Client, { id, revision, filename, bytes }: Extract<ClientMessage, { type: 'pdfExport' }>) {
    const reply = (outcome: Omit<Extract<HostMessage, { type: 'pdfExportResult' }>, 'type' | 'id'>) => this.post(view, client, { type: 'pdfExportResult', id, ...outcome })
    if (client.pdfExport !== undefined) return reply({ status: 'error', message: 'A PDF copy is already being saved.' })
    const current = () => view.client === client && !!document.rich && document.revision === revision && !document.lifetime.signal.aborted
    if (!current()) return reply({ status: 'error', message: stale })
    client.pdfExport = id
    try {
      const result = await savePdfCopy(document.uri, filename, new Uint8Array(bytes), current)
      reply(result.status === 'saved' ? { status: 'saved', name: result.name } : { status: 'cancelled' })
    } catch (error) { reply({ status: 'error', message: errorMessage(error) }) }
    finally { client.pdfExport = undefined }
  }

  saveCustomDocument(document: DocxDocument, token: vscode.CancellationToken) {
    return document.serialize(() => this.save(document, token))
  }

  saveCustomDocumentAs(document: DocxDocument, destination: vscode.Uri, token: vscode.CancellationToken) {
    return document.serialize(async () => {
      if (isSameFile(destination, document.uri)) return this.save(document, token)
      const { rich, original } = this.writable(document, token)
      const { signal, dispose } = cancellation(token, document.lifetime.signal)
      try {
        if (!await this.saver.available(destination)) throw new BinarySaveError(copyRequired)
        await this.saver.confirm(original.fingerprint, document.uri.path.split('/').at(-1) || 'DOCX', docxLosses(original.issues), true)
        const { bytes } = await runDocxWorker({ operation: 'write', document: rich }, signal)
        if (token.isCancellationRequested) throw new vscode.CancellationError()
        await this.saver.saveAs(destination, bytes, 'docx')
      } catch (error) { this.reportSave(document, error) }
      finally { dispose() }
    })
  }

  private writable(document: DocxDocument, token: vscode.CancellationToken) {
    if (token.isCancellationRequested) throw new vscode.CancellationError()
    const { rich, original } = document
    if (!rich || !original) throw new Error('The DOCX document is unavailable.')
    if (!document.nativeSave) this.reportSave(document, new BinarySaveError(copyRequired))
    return { rich, original }
  }

  private reportSave(document: DocxDocument, error: unknown): never {
    if (!(error instanceof vscode.CancellationError)) {
      if (error instanceof BinarySaveError && error.conflict) document.external = true
      document.saveNotice = errorMessage(error)
      this.publish(document)
      const view = this.views.get(document)
      if (view?.client) this.post(view, view.client, { type: 'error', message: errorMessage(error) })
    }
    throw error
  }

  /** Writes the draft over the opened file only while the file still has the fingerprint Folio expects. */
  private async save(document: DocxDocument, token: vscode.CancellationToken) {
    const { rich, original } = this.writable(document, token)
    const expected = document.disk
    if (!document.unsaved || !expected) return
    if (document.external) this.reportSave(document, new BinarySaveError(externalRefusal, true))
    const source = document.source
    const { signal, dispose } = cancellation(token, document.lifetime.signal)
    try {
      await this.saver.confirm(expected, document.uri.path.split('/').at(-1) || 'DOCX', [
        'Word page layout, styles and fonts. Folio uses its own page defaults and styles.', ...docxLosses(original.issues)])
      const { bytes } = await runDocxWorker({ operation: 'write', document: rich }, signal)
      const saved = await importPackage(bytes, signal)
      const written = await this.saver.replace(document.uri, expected, bytes, token)
      this.saver.remember(written)
      document.original = saved
      document.disk = written
      document.clean = source
      document.dirty = document.external = false
      document.saveNotice = document.revertError = undefined
      await this.recovery.update(prefix + document.journalId, undefined).then(undefined, () => undefined)
      this.publish(document)
      await retireDocxBackup(document)
    } catch (error) { this.reportSave(document, error) }
    finally { dispose() }
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
        document.saveNotice = undefined
        document.revision++
        document.historyEpoch++
        this.publish(document)
        await retireDocxBackup(document)
      } catch (error) {
        if (document.lifetime.signal.aborted) throw error
        // VS Code clears custom editor history before the asynchronous provider revert returns.
        if (document.dirty && document.original) {
          document.historyEpoch++
          this.emitHistory(document, document.original.source, document.source, 'Preserve DOCX draft after failed revert')
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
