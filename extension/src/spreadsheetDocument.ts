import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { spreadsheetLimits, type SpreadsheetFormat, type Workbook } from '../../src/document/formats/spreadsheet/model'
import { isFingerprint, isGeneration, isRecord } from '../../src/host/vscode/recovery'
import { readSpreadsheetSnapshot, spreadsheetSnapshotLimit } from '../../src/host/vscode/spreadsheetProtocol'
import { fingerprint } from './docxDocument'
import { readLocalDocument } from './localDocumentFile'
import { runSpreadsheetWorker } from './spreadsheetWorker'

const backupName = /^folio-spreadsheet-[\da-f-]+\.backup$/i
const backupLimit = 96 * 1024 * 1024
export const spreadsheetExternalNotice = 'The workbook on disk changed or became unavailable. Folio kept the opened workbook and its draft. Revert from disk to load the current file.'

export interface WorkbookOriginal {
  bytes: Uint8Array<ArrayBuffer>
  fingerprint: string
  source: string
}

export interface WorkbookCheckpoint {
  version: 1
  uri: string
  revision: number
  fingerprint: string
  source: string
}

export async function loadWorkbookOriginal(format: SpreadsheetFormat, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<WorkbookOriginal> {
  const { workbook } = await runSpreadsheetWorker({ operation: format === 'xlsx' ? 'read' : 'readCsv', bytes }, signal)
  const source = JSON.stringify(workbook)
  parseWorkbookDraft(source, format)
  return { bytes, fingerprint: fingerprint(bytes), source }
}

export function parseWorkbookDraft(source: string, format: SpreadsheetFormat): Workbook {
  if (Buffer.byteLength(source) > spreadsheetSnapshotLimit) throw new Error('This workbook draft exceeds Folio’s storage limit.')
  const workbook = readSpreadsheetSnapshot(source)
  if ((format === 'csv') !== !!workbook.csv) throw new Error('The workbook draft has the wrong file format.')
  return workbook
}

export function isWorkbookCheckpoint(value: unknown, uri: vscode.Uri): value is WorkbookCheckpoint {
  return isRecord(value) && value.version === 1 && value.uri === uri.toString() && isGeneration(value.revision) &&
    value.revision < Number.MAX_SAFE_INTEGER && isFingerprint(value.fingerprint) &&
    typeof value.source === 'string' && value.source.length <= spreadsheetSnapshotLimit
}

export class SpreadsheetDocument implements vscode.CustomDocument {
  readonly lifetime = new AbortController()
  readonly checkpointPrefix: string
  revision = 1
  historyEpoch = 0
  undoDepth = 0
  redoDepth = 0
  source?: string
  workbook?: Workbook
  original?: WorkbookOriginal
  failure?: string
  notice?: string
  external = false
  dirty = false
  restored = false
  /** SHA-256 the file on disk must still have for an in-place Save. It differs from the original after an interrupted save. */
  disk?: string
  /** Draft source that matches the file on disk. */
  clean?: string
  nativeSave = false
  saveNotice?: string
  /** Whether the webview has local calculation enabled, so Save may refresh supported formula caches. */
  calculationAllowed = false
  /** Increments when the workbook is loaded from disk. */
  session = 1
  private operations = Promise.resolve()

  constructor(readonly uri: vscode.Uri, readonly format: SpreadsheetFormat) {
    this.checkpointPrefix = 'folio.recovery.v1.spreadsheet.' + fingerprint(uri.toString()) + '.'
  }

  get checkpointKey() { return this.checkpointPrefix + this.original?.fingerprint }

  install(original: WorkbookOriginal, source = original.source) {
    const workbook = parseWorkbookDraft(source, this.format)
    this.original = original
    this.source = source
    this.workbook = workbook
    this.disk = original.fingerprint
    this.clean = original.source
    this.failure = undefined
  }

  /** Whether the draft differs from the file Folio last read or wrote. */
  get unsaved() { return this.source !== this.clean || this.disk !== this.original?.fingerprint }

  serialize<T>(operation: () => Promise<T>) {
    const result = this.operations.then(operation)
    this.operations = result.then(() => undefined, () => undefined)
    return result
  }

  checkpoint(source: string, revision: number): WorkbookCheckpoint {
    if (!this.original) throw new Error('The original workbook is unavailable.')
    return { version: 1, uri: this.uri.toString(), revision, fingerprint: this.original.fingerprint, source }
  }

  dispose() { this.lifetime.abort() }
}

export async function restoreSpreadsheetBackup(document: SpreadsheetDocument, id: string, root: vscode.Uri, signal: AbortSignal) {
  const uri = vscode.Uri.parse(id, true)
  if (vscode.Uri.joinPath(uri, '..').toString() !== root.toString() || !backupName.test(uri.path.split('/').at(-1) ?? '')) {
    throw new Error('Folio could not identify this workbook backup.')
  }
  const bytes = await readLocalDocument(uri, backupLimit, signal)
  const record: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!isRecord(record) || !isWorkbookCheckpoint(record, document.uri) ||
    typeof record.original !== 'string' || record.original.length > 4 * Math.ceil(spreadsheetLimits.fileBytes / 3)) {
    throw new Error('This workbook backup is invalid or belongs to a different document.')
  }
  const original = Uint8Array.from(Buffer.from(record.original, 'base64'))
  if (original.length > spreadsheetLimits.fileBytes || fingerprint(original) !== record.fingerprint) {
    throw new Error('The original workbook in the backup failed verification.')
  }
  document.install(await loadWorkbookOriginal(document.format, original, signal), record.source)
  document.revision = record.revision + 1
  document.dirty = true
  document.restored = true
}

export async function writeSpreadsheetBackup(document: SpreadsheetDocument, destination: vscode.Uri, signal: AbortSignal): Promise<vscode.CustomDocumentBackup> {
  signal.throwIfAborted()
  if (!document.original || document.source === undefined) throw new Error('The opened workbook is unavailable.')
  const folder = vscode.Uri.joinPath(destination, '..')
  const uri = vscode.Uri.joinPath(folder, `folio-spreadsheet-${randomUUID()}.backup`)
  const data = Buffer.from(JSON.stringify({
    ...document.checkpoint(document.source, document.revision),
    original: Buffer.from(document.original.bytes).toString('base64'),
  }))
  if (data.byteLength > backupLimit) throw new Error('The workbook backup exceeds Folio’s storage limit.')
  const remove = () => Promise.resolve(vscode.workspace.fs.delete(uri, { recursive: false })).catch(() => undefined)
  await vscode.workspace.fs.createDirectory(folder)
  signal.throwIfAborted()
  try {
    await vscode.workspace.fs.writeFile(uri, data)
    signal.throwIfAborted()
    return { id: uri.toString(), delete: () => { void remove() } }
  } catch (error) {
    await remove()
    throw error
  }
}
