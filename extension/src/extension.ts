import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import * as vscode from 'vscode'
import { concurrentWorkspaceImages, connectionMessage, isClientMessage, spliceSource, type ClientMessage, type DocumentState, type HostMessage, type PendingCheckpoint } from '../../src/host/vscode/protocol'
import { isId, recoveryPrefix, type RecoveryDraft } from '../../src/host/vscode/recovery'
import { webviewHtml } from './webview'
import { encodeRecoveryBase, recoveryGeneration, unpackRecovery, type PackedRecovery } from './packedRecovery'
import { nativeCommands, type NativeAction } from '../../src/host/vscode/nativeCommands'
import { openWorkspaceMarkdown, workspaceImage } from './resources'
import { confirmWorkspaceImage, pickWorkspaceImage, type WorkspaceImageSelection } from './imagePicker'
import { containsBinaryControls, decodeTxt, maxTxtImportBytes, TxtInputError } from '../../src/document/formats/txt'
import { isLocalDocumentFile, readLocalDocument } from './localDocumentFile'
import { DocxEditorProvider, docxViewType } from './docxEditor'
import { PdfEditorProvider, pdfViewType } from './pdfEditor'
import { SpreadsheetEditorProvider, csvViewType, xlsxViewType } from './spreadsheetEditor'
import { savePdfCopy } from './pdfCopy'

const viewType = 'folio.markdown'
const txtViewType = 'folio.txt'
const unavailable = 'This document was moved, deleted, or closed. Reopen it from VS Code to continue.'
const providerUnavailable = 'The workspace filesystem is temporarily unavailable. Review your pending draft before continuing.'
const stale = 'The document changed in VS Code before this edit could be applied.'
const fileVerificationRetryMs = 3_000
const fileVerificationIntervalMs = 250

type Acknowledgement = Extract<HostMessage, { type: 'state' | 'accepted' }>
type EditMessage = Extract<ClientMessage, { type: 'edit' }>
type CommandMessage = Extract<ClientMessage, { type: 'command' }>
type ImagePickerMessage = Extract<ClientMessage, { type: 'pickWorkspaceImage' | 'confirmWorkspaceImage' }>
type PdfExportMessage = Extract<ClientMessage, { type: 'pdfExport' }>

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
  backupBase: { revision: number; source: string; encoded?: PackedRecovery['base'] }
  imageReads: number
  pdfExport?: number
  navigation?: number
  imagePickerRequest?: number
  imageSelections?: { id: number; revision: number; image: WorkspaceImageSelection }[]
  acknowledgement?: Acknowledgement
}

interface Session {
  document: vscode.TextDocument
  fileBacked: boolean
  state: DocumentState
  views: Set<View>
  operations: Promise<void>
  queued: number
  pending?: { view: View; expected: string; committed?: DocumentState }
  watcher?: vscode.Disposable
  txtCheck?: Promise<void>
  txtIssue?: string
}

function documentState(document: vscode.TextDocument, available: boolean, previous?: DocumentState): DocumentState {
  const revision = document.version
  return {
    uri: document.uri.toString(),
    title: document.uri.path.split('/').at(-1) || document.fileName,
    revision,
    source: previous?.revision === revision ? previous.source : document.getText().replace(/\r\n?/g, '\n'),
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

function txtEncodingIssue(document: vscode.TextDocument) {
  if (document.encoding !== 'utf8' && document.encoding !== 'utf8bom') {
    return 'This TXT editor supports UTF-8 with an optional BOM. Check the encoding in VS Code’s native Text Editor.'
  }
}

function txtFileByteLength(source: string, state: DocumentState) {
  let bytes = Buffer.byteLength(source, 'utf8') + (state.bom ? 3 : 0)
  if (state.eol === '\r\n') {
    for (let offset = source.indexOf('\n'); offset >= 0; offset = source.indexOf('\n', offset + 1)) bytes++
  }
  return bytes
}

async function txtFileIssue(document: vscode.TextDocument) {
  if (!isLocalDocumentFile(document.uri)) return 'Folio TXT editing is available for local files. Use the native Text Editor for this provider.'
  try {
    const decoded = decodeTxt(await readLocalDocument(document.uri, maxTxtImportBytes))
    if (decoded.mixedLineEndings || decoded.lineEnding === '\r') {
      return 'This TXT file uses mixed or CR-only line endings. Folio shows the native buffer read-only. VS Code’s own Save command can still normalize the file.'
    }
    if (decoded.bom !== (document.encoding === 'utf8bom')) return 'The saved TXT BOM and VS Code encoding differ. Reopen the file with its original UTF-8 encoding to edit.'
    if (decoded.source.includes('\n') && decoded.lineEnding !== (document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n')) {
      return 'The saved TXT line endings and VS Code buffer differ. Reopen the file to review it before editing.'
    }
  } catch (error) {
    if (error instanceof TxtInputError) return error.message + ' Open the native Text Editor to review this file.'
    return error instanceof TypeError ? 'This TXT file is outside Folio’s UTF-8 compatibility scope.' :
      'Folio could not verify TXT encoding and line endings. Check that the file is available and no larger than 16 MiB.'
  }
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
  private imagePickerOpen = false

  constructor(private readonly assetsRoot: vscode.Uri, private readonly recovery: vscode.Memento, private readonly scope: string,
    private readonly format: 'markdown' | 'txt' = 'markdown') {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        const session = this.sessions.get(document)
        if (session) {
          this.refresh(session)
          if (this.format === 'txt' && !document.isDirty) void this.checkTxtFile(session)
        }
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
    const html = await webviewHtml(panel.webview, this.assetsRoot, this.format === 'txt' ? 'TXT' : 'Markdown')
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
            const { revision, source } = session.state
            view.client = { connection, journalId: randomUUID(), lastEdit: 0, abandoned: 0, generation: 0, backupBase: { revision, source }, imageReads: 0 }
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
        if (message.type === 'cancelWorkspaceImage') {
          if (client.imagePickerRequest === message.id) client.imagePickerRequest = undefined
          client.imageSelections = client.imageSelections?.filter(selection => selection.id !== message.id)
          return
        }
        if (message.type === 'pickWorkspaceImage' || message.type === 'confirmWorkspaceImage') {
          if (this.format !== 'markdown') return
          return void this.selectImage(session, view, client, message)
        }
        if (message.type === 'cancelResource') {
          if (client.navigation === message.id) client.navigation = undefined
          return
        }
        if (message.type === 'resource') {
          if (this.format !== 'markdown') return
          const valid = () => !view.disposed && view.client === client && session.state.available && !session.document.isClosed
          const { id, operation, reference } = message
          if (!valid()) return this.post(view, { type: 'resourceResult', id, ok: false }, client)
          if (operation === 'image') {
            if (client.imageReads >= concurrentWorkspaceImages) return this.post(view, { type: 'resourceResult', id, ok: false }, client)
            client.imageReads++
          } else client.navigation = id
          const expires = Date.now() + 8000
          const result = operation === 'image'
            ? workspaceImage(document, reference).then(image => ({ ok: image !== undefined, image }))
            : openWorkspaceMarkdown(document, reference, panel.viewColumn,
              () => valid() && panel.active && client.navigation === id && Date.now() < expires).then(ok => ({ ok }))
          void result.then(
            outcome => { if (valid()) this.post(view, { type: 'resourceResult', id, ...outcome }, client) },
            () => this.post(view, { type: 'resourceResult', id, ok: false }, client),
          ).finally(() => {
            if (operation === 'image') client.imageReads--
            else if (client.navigation === id) client.navigation = undefined
          })
          return
        }
        if (message.type === 'copy') {
          const { id, text } = message
          void vscode.env.clipboard.writeText(text).then(
            () => this.post(view, { type: 'copied', id, copied: true }, client),
            () => this.post(view, { type: 'copied', id, copied: false }, client),
          )
          return
        }
        if (message.type === 'spreadsheetEdit' || message.type === 'spreadsheetCommand' || message.type === 'spreadsheetCancel' ||
          message.type === 'spreadsheetExport' || message.type === 'spreadsheetOriginal' || message.type === 'spreadsheetCsvDialect' ||
          message.type === 'docxFile' || message.type === 'cancelDocxFile' || message.type === 'pdfReload') return
        if (message.type === 'pdfExport') return void this.exportPdf(session, view, client, message)
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
    if (session.txtCheck) await session.txtCheck
    if (view.disposed || token.isCancellationRequested || document.isClosed) {
      this.removeView(session, view)
      return
    }
    panel.webview.html = html
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.dispose()
    for (const session of this.sessions.values()) for (const view of session.views) this.removeView(session, view)
  }

  runAction(action: NativeAction) {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    if (!(input instanceof vscode.TabInputCustom) || input.viewType !== viewType) return
    for (const session of this.sessions.values()) {
      if (session.state.uri !== input.uri.toString() || !session.state.available) continue
      const view = [...session.views].find(view => view.panel.active)
      if (view) this.post(view, { type: 'action', action })
      return
    }
  }

  private createSession(document: vscode.TextDocument): Session {
    const fileBacked = !document.isUntitled && vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) !== undefined
    const session: Session = { document, fileBacked, state: documentState(document, !document.isClosed), views: new Set(), operations: Promise.resolve(), queued: 0 }
    this.sessions.set(document, session)
    if (this.format === 'txt') void this.checkTxtFile(session)
    if (fileBacked) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), '*'))
      const verify = (uri: vscode.Uri) => {
        if (within(document.uri, uri)) {
          void this.verifyFile(session).then(available => {
            if (available && this.format === 'txt') return this.checkTxtFile(session)
          }).catch(() => undefined)
        }
      }
      session.watcher = vscode.Disposable.from(watcher, watcher.onDidDelete(verify), watcher.onDidChange(verify))
    }
    return session
  }

  private checkTxtFile(session: Session) {
    const check = txtFileIssue(session.document).then(issue => {
      if (session.txtCheck !== check) return
      session.txtIssue = issue
      session.txtCheck = undefined
      this.refresh(session)
    })
    session.txtCheck = check
    return check
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

  private async verifyFile(session: Session, retryWhile?: () => boolean) {
    const { document } = session
    const deadline = retryWhile ? Date.now() + fileVerificationRetryMs : 0
    while (session.state.available) {
      if (document.isClosed) {
        this.invalidate(session)
        return false
      }
      // A provider can temporarily unregister. Keep verifying URIs already known to be file-backed.
      if (document.isUntitled || (!session.fileBacked && vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === undefined)) return true
      try {
        const file = await vscode.workspace.fs.stat(document.uri)
        if (!(file.type & vscode.FileType.File)) this.invalidate(session)
        return session.state.available
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError)) throw error
        if (error.code === 'FileNotFound') {
          this.invalidate(session)
          return false
        }
        const remaining = deadline - Date.now()
        if (error.code !== 'Unavailable' || remaining <= 0 || !retryWhile?.()) throw error
        await delay(Math.min(fileVerificationIntervalMs, remaining))
        if (!retryWhile() || Date.now() >= deadline) throw error
      }
    }
    return false
  }

  private async selectImage(session: Session, view: View, client: Client, message: ImagePickerMessage) {
    const { id, revision } = message
    const browsing = message.type === 'pickWorkspaceImage'
    const busy = 'An image picker is already open. Close it before browsing again.'
    const reply = (outcome: Omit<Extract<HostMessage, { type: 'imagePickerResult' }>, 'type' | 'id'>) =>
      this.post(view, { type: 'imagePickerResult', id, ...outcome }, client)
    if (client.imagePickerRequest !== undefined || (browsing && this.imagePickerOpen)) return reply({ error: busy })
    if (!view.panel.active) return reply({ error: 'Activate this Folio editor before browsing or inserting a workspace image.' })
    client.imagePickerRequest = id
    if (browsing) this.imagePickerOpen = true
    const active = () => !view.disposed && view.client === client && client.imagePickerRequest === id
    const check = () => {
      if (!active() || session.document.isClosed || !session.state.available) throw new Error(unavailable)
      if (session.document.version !== revision) throw new Error('The document changed while selecting an image. Reopen Insert image to use the current selection.')
    }
    try {
      check()
      if (!await this.verifyFile(session)) throw new Error(unavailable)
      check()
      if (browsing) {
        // Keep the displayed selection until the webview can decode a replacement.
        // Each browse retains at most that selection and one new candidate.
        client.imageSelections = client.imageSelections?.filter(selection =>
          selection.id === message.previousSelection && selection.revision === revision) ?? []
        const result = await pickWorkspaceImage(session.document, check)
        if (!result) { if (active()) reply({}); return }
        if (!await this.verifyFile(session)) throw new Error(unavailable)
        check()
        client.imageSelections.push({ id, revision, image: result.image })
        reply({ reference: result.image.reference, preview: result.preview })
      } else {
        const selection = client.imageSelections?.find(item => item.id === message.selection && item.revision === revision)
        if (!selection) {
          throw new Error('The selected image has expired. Browse again.')
        }
        const reference = await confirmWorkspaceImage(session.document, selection.image)
        if (!await this.verifyFile(session)) throw new Error(unavailable)
        check()
        client.imageSelections = undefined
        reply({ reference })
      }
    } catch (error) {
      if (active()) {
        // Prefer a document error if the view became stale during a filesystem request.
        let failure = error
        try { check() } catch (stale) { failure = stale }
        reply({ error: failure instanceof vscode.FileSystemError || !(failure instanceof Error)
          ? 'VS Code could not access this workspace. Check that it is available and try again.' : failure.message.slice(0, 512) })
      }
    } finally {
      if (client.imagePickerRequest === id) client.imagePickerRequest = undefined
      if (browsing) this.imagePickerOpen = false
    }
  }

  /** Saves a reviewed PDF copy only while the native document still has the reviewed revision. */
  private async exportPdf(session: Session, view: View, client: Client, { id, revision, filename, bytes }: PdfExportMessage) {
    const reply = (outcome: Omit<Extract<HostMessage, { type: 'pdfExportResult' }>, 'type' | 'id'>) =>
      this.post(view, { type: 'pdfExportResult', id, ...outcome }, client)
    if (client.pdfExport !== undefined) return reply({ status: 'error', message: 'A PDF copy is already being saved.' })
    const current = () => !view.disposed && view.client === client && session.state.available && !session.document.isClosed &&
      session.document.version === revision
    if (!current()) return reply({ status: 'error', message: 'The document changed after the PDF preview was generated. Export again from the current revision.' })
    client.pdfExport = id
    try {
      const result = await savePdfCopy(session.document.uri, filename, new Uint8Array(bytes), current)
      reply(result.status === 'saved' ? { status: 'saved', name: result.name } : { status: 'cancelled' })
    } catch (error) {
      reply({ status: 'error', message: error instanceof Error ? error.message.slice(0, 900) : 'VS Code could not save the PDF copy.' })
    } finally { client.pdfExport = undefined }
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
    const previous = session.state
    const next = documentState(session.document, !session.document.isClosed, previous)
    if (this.format === 'txt') {
      next.format = 'txt'
      next.readOnly = txtEncodingIssue(session.document) ?? session.txtIssue
    }
    if (previous.revision === next.revision && previous.dirty === next.dirty && previous.available === next.available &&
      previous.eol === next.eol && previous.bom === next.bom && previous.format === next.format && previous.readOnly === next.readOnly) return
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
    const { source: _confirmedProposal, ...metadata } = state
    // An accepted proposal was checked against the exact native text in apply().
    const reply: Acknowledgement = accepted
      ? { type: 'accepted', state: metadata, edit: { id } }
      : { type: 'state', state, edit: { id, accepted, message } }
    client.acknowledgement = reply
    this.post(view, reply, client)
  }

  private sendStatus(session: Session, view: View) {
    const client = view.client
    if (!client || view.disposed) return
    const drafts: RecoveryDraft[] = []
    const prefix = this.journalPrefix()
    for (const key of this.recovery.keys()) {
      if (!key.startsWith(prefix) || this.activeJournals.has(key.slice(prefix.length))) continue
      const draft = unpackRecovery(this.recovery.get(key))
      if (draft && key === prefix + draft.id) drafts.push(draft)
    }
    this.post(view, { type: 'recovery', scope: this.scope, id: client.journalId, active: [...this.activeJournals], drafts, baseRevision: client.backupBase.revision })
    if (client.acknowledgement) this.post(view, client.acknowledgement)
    if (session.pending?.view !== view) this.sendState(view, session.state)
  }

  private async checkpoint(session: Session, view: View, client: Client, draft: RecoveryDraft | PendingCheckpoint) {
    const { id, uri, generation } = draft
    if (id !== client.journalId || uri !== session.state.uri || generation <= client.generation) return
    client.generation = generation
    let stored = false
    try {
      let record: RecoveryDraft | PackedRecovery
      if ('baseRevision' in draft) {
        const base = client.backupBase
        if (draft.baseRevision !== base.revision || !base.source || (draft.change && draft.change.to > base.source.length)) return
        base.encoded ??= encodeRecoveryBase(base.source)
        record = { id, uri, generation, eol: draft.eol, bom: draft.bom, baseRevision: draft.baseRevision,
          change: draft.change, encoding: 'deflate-utf16-v1', base: base.encoded }
      } else record = draft
      await this.recovery.update(this.journalPrefix() + id, record)
      stored = true
    } catch { /* The webview continues to retain its locally stored generation. */ }
    finally { this.post(view, { type: 'stored', id, generation, stored }, client) }
  }

  private async dismiss(view: View, client: Client, { id, generation }: Extract<ClientMessage, { type: 'dismiss' }>) {
    if (id !== client.journalId && this.activeJournals.has(id)) {
      this.post(view, { type: 'dismissed', id, generation, dismissed: false }, client)
      return
    }
    const key = this.journalPrefix() + id
    const current = this.recovery.get(key)
    let dismissed = false
    try {
      // Compare with both the stored value and the newest generation submitted by this view.
      if (recoveryGeneration(current) > generation || (id === client.journalId && client.generation > generation)) return
      if (id === client.journalId) client.generation = Math.max(client.generation, generation)
      if (current !== undefined) await this.recovery.update(key, undefined)
      dismissed = true
    } catch { /* The webview retains its recovery copy on failure. */ }
    finally { this.post(view, { type: 'dismissed', id, generation, dismissed }, client) }
  }

  private journalPrefix() { return this.format === 'txt' ? recoveryPrefix + 'txt.' : recoveryPrefix }

  private async apply(session: Session, view: View, client: Client, { id, revision, change }: EditMessage) {
    const reject = (message: string) => this.acknowledge(view, client, session.state, id, false, message)
    if (id <= client.lastEdit) {
      if (client.acknowledgement?.edit?.id === id) this.post(view, client.acknowledgement, client)
      return
    }
    client.lastEdit = id
    if (id <= client.abandoned) return reject('This Folio edit expired before it reached VS Code.')
    try {
      if (!await this.verifyFile(session, () => !view.disposed && view.client === client && id > client.abandoned)) return reject(unavailable)
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'Unavailable') return reject(providerUnavailable)
      throw error
    }
    if (id <= client.abandoned || view.client !== client) return reject('This Folio edit expired before it reached VS Code.')
    const { document } = session
    if (!session.state.available || document.isClosed) return reject(unavailable)
    if (this.format === 'txt') {
      while (session.txtCheck) await session.txtCheck
      if (id <= client.abandoned || view.client !== client || !session.state.available || document.isClosed) return reject(unavailable)
    }
    this.refresh(session)
    const base = session.state
    if (base.readOnly) return reject(base.readOnly)
    if (base.revision !== revision) return reject(stale)
    if (change.to > base.source.length) return reject('The edit range is invalid.')
    const expected = spliceSource(base.source, change)
    if (expected === base.source) return reject('This edit did not change the document.')
    if (this.format === 'txt' && (txtFileByteLength(expected, base) > maxTxtImportBytes || containsBinaryControls(expected) || /[\uD800-\uDFFF]/u.test(expected) ||
      !base.bom && expected.startsWith('\uFEFF'))) {
      return reject('This TXT edit exceeds the limit or contains invalid Unicode, binary controls, or a leading BOM character.')
    }

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
    while (session.txtCheck) await session.txtCheck
    if (view.disposed || view.client !== client) return
    if (!available || !session.state.available || session.document.isClosed) this.post(view, { type: 'error', message: unavailable }, client)
    else if (session.state.readOnly) this.post(view, { type: 'error', message: session.state.readOnly }, client)
    else if (command === 'save') {
      if (!await session.document.save()) this.post(view, { type: 'error', message: 'VS Code could not save this document.' }, client)
      this.refresh(session)
    } else {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      if (view.panel.active && input instanceof vscode.TabInputCustom && input.viewType === (this.format === 'txt' ? txtViewType : viewType) && input.uri.toString() === session.state.uri) {
        await vscode.commands.executeCommand(command === 'revert' ? 'workbench.action.files.revert' : command)
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
  const assets = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')
  const provider = new FolioEditorProvider(assets, context.workspaceState, scope)
  const txt = new FolioEditorProvider(assets, context.workspaceState, createHash('sha256').update(scope + '/txt').digest('hex'), 'txt')
  const docx = new DocxEditorProvider(assets, context.workspaceState, createHash('sha256').update(scope + '/docx').digest('hex'),
    context.storageUri ?? context.globalStorageUri)
  context.subscriptions.push(provider, vscode.window.registerCustomEditorProvider(viewType, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  }))
  context.subscriptions.push(txt, vscode.window.registerCustomEditorProvider(txtViewType, txt, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  }))
  context.subscriptions.push(docx, vscode.window.registerCustomEditorProvider(docxViewType, docx))
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(pdfViewType, new PdfEditorProvider(assets), {
    supportsMultipleEditorsPerDocument: true,
  }))
  const backupRoot = context.storageUri ?? context.globalStorageUri
  for (const [format, viewType] of [['xlsx', xlsxViewType], ['csv', csvViewType]] as const) {
    const spreadsheet = new SpreadsheetEditorProvider(format, assets, context.workspaceState, backupRoot)
    context.subscriptions.push(spreadsheet, vscode.window.registerCustomEditorProvider(viewType, spreadsheet, {
      webviewOptions: { retainContextWhenHidden: true },
    }))
  }
  for (const [command, action] of Object.entries(nativeCommands)) {
    context.subscriptions.push(vscode.commands.registerCommand(command, () => provider.runAction(action)))
  }
}
