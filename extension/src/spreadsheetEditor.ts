import * as vscode from 'vscode'
import { spreadsheetLimits, type SpreadsheetFormat, type Workbook } from '../../src/document/formats/spreadsheet/model'
import { connectionMessage, isClientMessage, sourceChange, spliceSource, type ClientMessage, type HostMessage, type Splice } from '../../src/host/vscode/protocol'
import type { SpreadsheetStateMeta } from '../../src/host/vscode/spreadsheetProtocol'
import { cancellation, fingerprint } from './docxDocument'
import { isLocalDocumentFile, readLocalDocument } from './localDocumentFile'
import { isSameSpreadsheetFile, saveSpreadsheetCopy } from './spreadsheetCopy'
import {
  isWorkbookCheckpoint, loadWorkbookOriginal, parseWorkbookDraft, restoreSpreadsheetBackup, SpreadsheetDocument,
  spreadsheetExternalNotice, writeSpreadsheetBackup,
} from './spreadsheetDocument'
import { BinarySaveError, externalRefusal, interruptedNotice, saveUnavailable, type BinarySaver } from './binarySave'
import { runSpreadsheetWorker } from './spreadsheetWorker'
import { attachAppearance } from './appearance'
import { webviewHtml } from './webview'

export const xlsxViewType = 'folio.xlsx'
export const csvViewType = 'folio.csv'
type Edit = Extract<ClientMessage, { type: 'spreadsheetEdit' }>
type FileRequest = Extract<ClientMessage, { type: 'spreadsheetOriginal' | 'spreadsheetExport' | 'spreadsheetCsvDialect' }>
type StateMessage = Extract<HostMessage, { type: 'spreadsheetState' }>
type EditResponse = StateMessage | Extract<HostMessage, { type: 'spreadsheetAccepted' }>

interface Client {
  connection: string
  lastEdit: number
  reply?: EditResponse
  file?: { id: number; controller: AbortController }
}
interface View {
  panel: vscode.WebviewPanel
  client?: Client
}

const stale = 'The workbook changed. Reload the current revision before trying again.'
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 1024) : 'VS Code could not complete this workbook operation.'

export class SpreadsheetEditorProvider implements vscode.CustomEditorProvider<SpreadsheetDocument> {
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<SpreadsheetDocument>>()
  private readonly views = new Map<SpreadsheetDocument, View>()
  readonly onDidChangeCustomDocument = this.changed.event

  constructor(private readonly format: SpreadsheetFormat, private readonly assets: vscode.Uri,
    private readonly recovery: vscode.Memento, private readonly backupRoot: vscode.Uri, private readonly saver: BinarySaver) {}

  private get kind() { return this.format === 'xlsx' ? 'XLSX' as const : 'CSV' as const }

  dispose() {
    this.changed.dispose()
    for (const [document, view] of this.views) {
      view.client?.file?.controller.abort()
      document.dispose()
    }
    this.views.clear()
  }

  private async openOriginal(document: SpreadsheetDocument, signal: AbortSignal) {
    const bytes = await readLocalDocument(document.uri, spreadsheetLimits.fileBytes, signal)
    return loadWorkbookOriginal(document.format, bytes, signal)
  }

  async openCustomDocument(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken) {
    const document = new SpreadsheetDocument(uri, this.format)
    const { signal, dispose } = cancellation(token)
    try {
      if (!vscode.workspace.isTrusted || !isLocalDocumentFile(uri)) {
        throw new Error('Folio spreadsheets require a trusted workspace and a local file.')
      }
      if (context.backupId) await restoreSpreadsheetBackup(document, context.backupId, this.backupRoot, signal)
      else {
        const bytes = await readLocalDocument(document.uri, spreadsheetLimits.fileBytes, signal)
        const journal = await this.saver.recover(uri, bytes)
        if (journal?.state === 'interrupted') {
          // Reopen the last complete file as the original and the content being saved as an unsaved draft.
          const previous = await loadWorkbookOriginal(document.format, journal.journal.previous, signal)
          const draft = await loadWorkbookOriginal(document.format, journal.journal.replacement, signal)
          document.install(previous, draft.source)
          document.disk = journal.disk
          document.dirty = document.restored = true
          document.saveNotice = interruptedNotice(this.kind)
        } else {
          document.install(await loadWorkbookOriginal(document.format, bytes, signal))
          if (journal) document.saveNotice = `An earlier Folio save of this ${this.kind} was interrupted and the file changed afterwards. Folio opened the current file and kept the save journal.`
        }
      }
      document.nativeSave = await this.saver.available(uri)
      const checkpoint: unknown = this.recovery.get(document.checkpointKey)
      if (isWorkbookCheckpoint(checkpoint, uri) && checkpoint.fingerprint === document.original?.fingerprint &&
        !document.saveNotice && (!document.restored || checkpoint.revision >= document.revision)) {
        try {
          document.install(document.original, checkpoint.source)
          document.revision = checkpoint.revision + 1
          document.dirty = document.restored = true
        } catch { document.notice = 'A previous workspace draft could not be restored. Folio kept the available workbook.' }
      } else if (!document.restored && this.recovery.keys().some(key => key.startsWith(document.checkpointPrefix) && key !== document.checkpointKey)) {
        document.notice = 'A recoverable draft belongs to a different version of this workbook. Reopening the matching file will restore it.'
      }
      if (context.backupId) await this.checkExternal(document, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (context.backupId) throw error
      document.failure = errorMessage(error)
    } finally { dispose() }
    return document
  }

  async resolveCustomEditor(document: SpreadsheetDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken) {
    // The shared dialogs need local submit events. The webview CSP blocks form navigation.
    panel.webview.options = { enableScripts: true, enableForms: true, localResourceRoots: [this.assets] }
    const html = await webviewHtml(panel.webview, this.assets, this.format === 'xlsx' ? 'XLSX' : 'CSV')
    if (token.isCancellationRequested) return
    const view: View = { panel }
    this.views.set(document, view)
    let timer: ReturnType<typeof setTimeout> | undefined
    const verify = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void this.checkExternal(document, document.lifetime.signal) }, 200)
    }
    const parent = vscode.Uri.joinPath(document.uri, '..')
    const watcher = document.original && vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(parent, '*'))
    if (watcher) {
      for (const watch of [watcher.onDidChange, watcher.onDidCreate, watcher.onDidDelete]) {
        watch(uri => { if (isSameSpreadsheetFile(uri, document.uri)) verify() })
      }
    }
    const visibility = panel.onDidChangeViewState(() => { if (panel.active && document.original) verify() })
    const listener = panel.webview.onDidReceiveMessage((incoming: unknown) => {
      const request = connectionMessage(incoming, isClientMessage)
      if (!request) return
      const { connection, message } = request
      if (message.type === 'ready') {
        if (view.client?.connection !== connection) {
          view.client?.file?.controller.abort()
          view.client = { connection, lastEdit: 0 }
        }
        if (document.restored) {
          document.restored = false
          this.seedHistory(document, 'Restore workbook draft')
        }
        this.publish(document)
        if (document.original) verify()
        return
      }
      const client = view.client
      if (!client || client.connection !== connection) return
      if (message.type === 'status') return this.publish(document)
      if (message.type === 'spreadsheetEdit') return void document.serialize(() => this.edit(document, view, client, message))
      if (message.type === 'spreadsheetCancel') {
        if (client.file?.id === message.id) client.file.controller.abort()
        return
      }
      if (message.type === 'spreadsheetOriginal' || message.type === 'spreadsheetExport' || message.type === 'spreadsheetCsvDialect') {
        return void this.deliver(document, view, client, message)
      }
      if (message.type === 'spreadsheetCalculation') {
        document.calculationAllowed = message.allowed
        return
      }
      if (message.type === 'spreadsheetCommand' && panel.active && document.original) {
        const command = message.command
        if (command === 'save' && !document.nativeSave) return this.post(view, client, { type: 'error', message: saveUnavailable(this.kind) })
        void Promise.resolve(command === 'revert' && !document.dirty
          ? this.revert(document, document.lifetime.signal)
          : vscode.commands.executeCommand(command === 'revert' ? 'workbench.action.files.revert'
            : command === 'save' ? 'workbench.action.files.save' : command))
          .catch(error => this.post(view, client, { type: 'error', message: errorMessage(error) }))
      }
    })
    panel.onDidDispose(() => {
      clearTimeout(timer)
      if (watcher) watcher.dispose()
      visibility.dispose()
      listener.dispose()
      view.client?.file?.controller.abort()
      view.client = undefined
      if (this.views.get(document) === view) this.views.delete(document)
    })
    attachAppearance(panel)
    panel.webview.html = html
  }

  private meta(document: SpreadsheetDocument): SpreadsheetStateMeta {
    return { revision: document.revision, dirty: document.dirty, external: document.external,
      canUndo: document.undoDepth > 0, canRedo: document.redoDepth > 0 }
  }

  private state(document: SpreadsheetDocument): StateMessage['state'] {
    const notice = [document.external ? spreadsheetExternalNotice : undefined, document.saveNotice, document.notice,
      document.nativeSave || document.failure ? undefined : saveUnavailable(this.kind)].filter(Boolean).join(' ').slice(0, 1024)
    return { ...this.meta(document), title: document.uri.path.split('/').at(-1) || 'Workbook', uri: document.uri.toString(),
      format: document.format, source: document.source, fingerprint: document.original?.fingerprint,
      failure: document.failure, notice: notice || undefined, nativeSave: document.nativeSave, session: document.session }
  }

  private post(view: View, client: Client, message: HostMessage) {
    if (view.client === client) void Promise.resolve(view.panel.webview.postMessage({ connection: client.connection, message })).catch(() => undefined)
  }

  private publish(document: SpreadsheetDocument) {
    const view = this.views.get(document)
    if (view?.client) this.post(view, view.client, { type: 'spreadsheetState', state: this.state(document) })
  }

  private async checkExternal(document: SpreadsheetDocument, signal: AbortSignal) {
    const original = document.original
    if (!original) return
    let external = true
    try {
      const bytes = await readLocalDocument(document.uri, spreadsheetLimits.fileBytes, signal)
      external = fingerprint(bytes) !== (document.disk ?? original.fingerprint)
    } catch { /* A missing or unreadable file leaves the draft available. */ }
    if (signal.aborted || document.original !== original || document.external === external) return
    document.external = external
    this.publish(document)
  }

  private async commit(document: SpreadsheetDocument, after: string) {
    document.lifetime.signal.throwIfAborted()
    const workbook = parseWorkbookDraft(after, document.format)
    const previous = document.workbook
    if (!previous || workbook.imported !== previous.imported || workbook.date1904 !== previous.date1904 ||
      (document.format === 'xlsx' && JSON.stringify(workbook.warnings) !== JSON.stringify(previous.warnings))) {
      throw new Error('The draft changed original workbook compatibility metadata.')
    }
    const revision = document.revision + 1
    // Dirty state follows content, so undoing past a save keeps a recovery checkpoint for a draft that differs from disk.
    const dirty = after !== document.clean || document.disk !== document.original?.fingerprint
    await this.recovery.update(document.checkpointKey, dirty ? document.checkpoint(after, revision) : undefined)
    document.source = after
    document.workbook = workbook
    document.dirty = dirty
    document.revision = revision
  }

  private async edit(document: SpreadsheetDocument, view: View, client: Client, edit: Edit) {
    if (view.client !== client) return
    if (edit.id <= client.lastEdit) {
      if (edit.id === client.lastEdit && client.reply) this.post(view, client, client.reply)
      return
    }
    client.lastEdit = edit.id
    let response: EditResponse
    try {
      const before = document.source
      if (before === undefined || edit.revision !== document.revision || !vscode.workspace.isTrusted) throw new Error(stale)
      const { change } = edit
      const after = spliceSource(before, change)
      if (after !== before) {
        const inverse = { from: change.from, to: change.from + change.text.length, text: before.slice(change.from, change.to) }
        await this.commit(document, after)
        this.emitHistory(document, change, inverse, 'Edit workbook')
      }
      response = { type: 'spreadsheetAccepted', id: edit.id, state: this.meta(document) }
    } catch (error) {
      response = { type: 'spreadsheetState', state: this.state(document), rejected: { id: edit.id, message: errorMessage(error) } }
    }
    client.reply = response
    this.post(view, client, response)
  }

  private seedHistory(document: SpreadsheetDocument, label: string) {
    const before = document.original?.source
    if (before === undefined || document.source === undefined) return
    const change = sourceChange(before, document.source)
    if (change) {
      const inverse = { from: change.from, to: change.from + change.text.length, text: before.slice(change.from, change.to) }
      this.emitHistory(document, change, inverse, label)
    }
  }

  private emitHistory(document: SpreadsheetDocument, forward: Splice, inverse: Splice, label: string) {
    const epoch = document.historyEpoch
    document.undoDepth++
    document.redoDepth = 0
    const apply = (change: Splice, direction: number) => document.serialize(async () => {
      if (epoch !== document.historyEpoch || document.source === undefined) return
      await this.commit(document, spliceSource(document.source, change))
      document.undoDepth += direction
      document.redoDepth -= direction
      this.publish(document)
    })
    this.changed.fire({ document, label, undo: () => apply(inverse, -1), redo: () => apply(forward, 1) })
  }

  private async deliver(document: SpreadsheetDocument, view: View, client: Client, request: FileRequest) {
    if (client.file) {
      this.post(view, client, { type: 'spreadsheetFileResult', id: request.id, status: 'error', message: 'Finish the current workbook export first.' })
      return
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, document.lifetime.signal])
    client.file = { id: request.id, controller }
    const current = () => view.client === client && !signal.aborted && document.revision === request.revision && vscode.workspace.isTrusted
    try {
      if (!document.workbook || !document.original || !current()) throw new Error(stale)
      if (request.type === 'spreadsheetCsvDialect') {
        await document.serialize(async () => {
          if (!current() || document.source === undefined || !document.original || document.format !== 'csv') throw new Error(stale)
          if (document.dirty) throw new Error('Revert the edited draft before reinterpreting the original CSV delimiter.')
          const before = document.source
          const { workbook } = await runSpreadsheetWorker({ operation: 'readCsv', bytes: document.original.bytes, delimiter: request.delimiter }, signal)
          if (!current()) throw new Error(stale)
          const after = JSON.stringify(workbook)
          const change = sourceChange(before, after)
          if (change) {
            const inverse = { from: change.from, to: change.from + change.text.length, text: before.slice(change.from, change.to) }
            await this.commit(document, after)
            this.emitHistory(document, change, inverse, 'Change CSV delimiter')
            this.publish(document)
          }
        })
        this.post(view, client, { type: 'spreadsheetFileResult', id: request.id, status: 'updated' })
        return
      }
      const original = request.type === 'spreadsheetOriginal'
      const format = original ? document.format : request.format
      const title = document.uri.path.split('/').at(-1) ?? 'Workbook'
      const filename = original ? title.replace(/\.[^.]+$/, '') + ` original.${format}` : request.filename
      let bytes: Uint8Array
      if (original) bytes = document.original.bytes
      else if (request.format === 'png') bytes = new Uint8Array(request.bytes)
      else {
        if (!document.workbook.sheets.some(sheet => sheet.id === request.sheetId)) throw new Error('The reviewed worksheet is unavailable.')
        if (request.format === 'xlsx') bytes = (await runSpreadsheetWorker({
          operation: 'write', workbook: document.workbook, includeCalculated: request.includeCalculated,
        }, signal)).bytes
        else bytes = (await runSpreadsheetWorker({ operation: 'writeCsv', workbook: document.workbook,
          options: { sheetId: request.sheetId, safety: request.safety, delimiter: request.delimiter } }, signal)).bytes
      }
      if (!current()) throw new Error(stale)
      const reply = await saveSpreadsheetCopy(document.uri, filename, format, bytes, current, original)
      this.post(view, client, { type: 'spreadsheetFileResult', id: request.id, ...reply })
    } catch (error) {
      const reply = signal.aborted ? { status: 'cancelled' as const } : { status: 'error' as const, message: errorMessage(error) }
      this.post(view, client, { type: 'spreadsheetFileResult', id: request.id, ...reply })
    } finally {
      if (client.file?.id === request.id) client.file = undefined
    }
  }

  saveCustomDocument(document: SpreadsheetDocument, token: vscode.CancellationToken) {
    return document.serialize(() => this.save(document, token))
  }

  saveCustomDocumentAs(document: SpreadsheetDocument, destination: vscode.Uri, token: vscode.CancellationToken) {
    return document.serialize(async () => {
      if (isSameSpreadsheetFile(destination, document.uri)) return this.save(document, token)
      const { workbook, original } = this.writable(document, token)
      const { signal, dispose } = cancellation(token, document.lifetime.signal)
      try {
        if (!await this.saver.available(destination)) throw new BinarySaveError(saveUnavailable(this.kind))
        const bytes = await this.encode(document, workbook, signal)
        await this.saver.confirm(original.fingerprint, this.name(document), await this.losses(document, workbook, original, signal), true)
        if (token.isCancellationRequested) throw new vscode.CancellationError()
        await this.saver.saveAs(destination, bytes, this.format)
      } catch (error) { this.reportSave(document, error) }
      finally { dispose() }
    })
  }

  private name(document: SpreadsheetDocument) { return document.uri.path.split('/').at(-1) || 'Workbook' }

  private writable(document: SpreadsheetDocument, token: vscode.CancellationToken) {
    if (token.isCancellationRequested) throw new vscode.CancellationError()
    const { workbook, original } = document
    if (!workbook || !original || document.source === undefined) throw new Error('The workbook is unavailable.')
    if (!document.nativeSave) this.reportSave(document, new BinarySaveError(saveUnavailable(this.kind)))
    return { workbook, original }
  }

  private reportSave(document: SpreadsheetDocument, error: unknown): never {
    if (!(error instanceof vscode.CancellationError)) {
      if (error instanceof BinarySaveError && error.conflict) document.external = true
      document.saveNotice = errorMessage(error)
      this.publish(document)
      const view = this.views.get(document)
      if (view?.client) this.post(view, view.client, { type: 'error', message: errorMessage(error) })
    }
    throw error
  }

  /** XLSX uses the export writer. CSV keeps the literal values and original dialect of its first worksheet. */
  private async encode(document: SpreadsheetDocument, workbook: Workbook, signal: AbortSignal) {
    if (document.format === 'xlsx') {
      return (await runSpreadsheetWorker({ operation: 'write', workbook, includeCalculated: document.calculationAllowed }, signal)).bytes
    }
    const sheet = workbook.sheets[0]
    return (await runSpreadsheetWorker({ operation: 'writeCsv', workbook,
      options: { sheetId: sheet.id, safety: 'literal', delimiter: workbook.csv?.delimiter } }, signal)).bytes
  }

  /** Content of the opened file that a rewrite does not keep. */
  private async losses(document: SpreadsheetDocument, workbook: Workbook, original: NonNullable<SpreadsheetDocument['original']>, signal: AbortSignal) {
    if (document.format === 'xlsx') {
      const losses = [...parseWorkbookDraft(original.source, 'xlsx').warnings]
      if (!document.calculationAllowed && workbook.sheets.some(sheet => Object.values(sheet.cells).some(cell => cell.kind === 'formula'))) {
        losses.push('Fresh formula results. Formulas keep their stored results, which can be stale until recalculated.')
      }
      return losses
    }
    const losses: string[] = []
    const [first, ...others] = workbook.sheets
    if (others.length) losses.push(`Worksheets other than “${first.name}”`)
    if (workbook.sheets.some(sheet => sheet.merges.length || sheet.rules.length || Object.values(sheet.cells).some(cell => cell.style || cell.link))) {
      losses.push('Cell formatting, links, merges and conditional rules (CSV stores values only)')
    }
    const opened = parseWorkbookDraft(original.source, 'csv')
    const roundTrip = await runSpreadsheetWorker({ operation: 'writeCsv', workbook: opened,
      options: { sheetId: opened.sheets[0].id, safety: 'literal', delimiter: opened.csv?.delimiter } }, signal)
    if (fingerprint(roundTrip.bytes) !== original.fingerprint) losses.push('The original quoting and line-ending layout. Folio rewrites the CSV in its normalized form with the same values.')
    return losses
  }

  /** Writes the draft over the opened file only while the file still has the fingerprint Folio expects. */
  private async save(document: SpreadsheetDocument, token: vscode.CancellationToken) {
    const { workbook, original } = this.writable(document, token)
    const expected = document.disk
    if (!document.unsaved || !expected) return
    if (document.external) this.reportSave(document, new BinarySaveError(externalRefusal, true))
    const source = document.source
    const { signal, dispose } = cancellation(token, document.lifetime.signal)
    try {
      const bytes = await this.encode(document, workbook, signal)
      await this.saver.confirm(expected, this.name(document), await this.losses(document, workbook, original, signal))
      const saved = await loadWorkbookOriginal(document.format, bytes, signal)
      const written = await this.saver.replace(document.uri, expected, bytes, token)
      this.saver.remember(written)
      await this.recovery.update(document.checkpointKey, undefined).then(undefined, () => undefined)
      document.original = saved
      document.disk = written
      document.clean = source
      document.dirty = document.external = false
      document.saveNotice = document.notice = undefined
      this.publish(document)
    } catch (error) { this.reportSave(document, error) }
    finally { dispose() }
  }

  private revert(document: SpreadsheetDocument, signal: AbortSignal) {
    return document.serialize(async () => {
      try {
        const original = await this.openOriginal(document, signal)
        signal.throwIfAborted()
        await this.recovery.update(document.checkpointKey, undefined)
        document.install(original)
        document.dirty = document.external = false
        document.saveNotice = undefined
        document.session++
        document.revision++
        document.historyEpoch++
        document.undoDepth = document.redoDepth = 0
        document.notice = undefined
        this.publish(document)
      } catch (error) {
        if (signal.aborted) throw error
        document.historyEpoch++
        document.undoDepth = document.redoDepth = 0
        if (document.dirty) this.seedHistory(document, 'Preserve workbook draft after failed revert')
        document.notice = 'Folio kept the draft because it could not revert. ' + errorMessage(error)
        this.publish(document)
        throw error
      }
    })
  }

  revertCustomDocument(document: SpreadsheetDocument, token: vscode.CancellationToken) {
    const { signal, dispose } = cancellation(token, document.lifetime.signal)
    return this.revert(document, signal).finally(dispose)
  }

  backupCustomDocument(document: SpreadsheetDocument, { destination }: vscode.CustomDocumentBackupContext, token: vscode.CancellationToken) {
    const { signal, dispose } = cancellation(token, document.lifetime.signal)
    return document.serialize(() => writeSpreadsheetBackup(document, destination, signal)).finally(dispose)
  }
}
