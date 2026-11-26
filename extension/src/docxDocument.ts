import { createHash, randomUUID } from 'node:crypto'
import type { JSONContent } from '@tiptap/core'
import * as vscode from 'vscode'
import { docxMaxFileBytes, readDocxSnapshot, type DocxIssue } from '../../src/document/formats/docx/model'
import { isGeneration, isId, isRecord } from '../../src/host/vscode/recovery'
import { readLocalDocument } from './localDocumentFile'
import { runDocxWorker } from './docxWorker'

export const docxCopyNotice = 'DOCX edits are kept as a recoverable draft. Use Export DOCX copy to review fidelity changes and create a separate file.'
export const docxExternalNotice = 'The DOCX on disk changed or became unavailable. This draft and its opened package are preserved. Use File → Revert to disk to load the current file, or export the draft as a copy.'

export interface DocxPackage {
  bytes: Uint8Array<ArrayBuffer>
  fingerprint: string
  document: JSONContent
  source: string
  issues: DocxIssue[]
}

async function importPackage(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<DocxPackage> {
  const { document, issues } = await runDocxWorker({ operation: 'read', bytes }, signal)
  const source = JSON.stringify(document)
  readDocxSnapshot(source)
  return { bytes, fingerprint: fingerprint(bytes), document, source, issues }
}

export function fingerprint(data: Uint8Array | string) {
  const hash = createHash('sha256')
  return (typeof data === 'string' ? hash.update(data, 'utf16le') : hash.update(data)).digest('hex')
}

export async function loadDocxPackage(uri: vscode.Uri, signal: AbortSignal) {
  return importPackage(await readLocalDocument(uri, docxMaxFileBytes, signal), signal)
}

const maxBackupBytes = 96 * 1024 * 1024
const backupName = /^folio-docx-[\da-f-]+\.backup$/i

export class DocxDocument implements vscode.CustomDocument {
  readonly lifetime = new AbortController()
  journalId = randomUUID()
  revision = 1
  historyEpoch = 0
  source = ''
  rich?: JSONContent
  original?: DocxPackage
  failure?: string
  revertError?: string
  external = false
  dirty = false
  fromBackup = false
  restoredBackup?: vscode.Uri
  private operations = Promise.resolve()

  constructor(readonly uri: vscode.Uri) {}

  install(original: DocxPackage, source = original.source, rich = original.document) {
    this.original = original
    this.source = source
    this.rich = rich
    this.failure = undefined
    this.revertError = undefined
  }

  serialize<T>(operation: () => Promise<T>) {
    const result = this.operations.then(operation)
    this.operations = result.then(() => undefined, () => undefined)
    return result
  }

  dispose() { this.lifetime.abort() }
}

export function cancellation(token: vscode.CancellationToken, lifetime?: AbortSignal) {
  const controller = new AbortController()
  const subscription = token.onCancellationRequested(() => controller.abort())
  if (token.isCancellationRequested) controller.abort()
  return { signal: lifetime ? AbortSignal.any([controller.signal, lifetime]) : controller.signal, dispose: () => subscription.dispose() }
}

export async function restoreDocxBackup(document: DocxDocument, id: string, storageRoot: vscode.Uri, signal: AbortSignal) {
  const uri = vscode.Uri.parse(id, true)
  if (vscode.Uri.joinPath(uri, '..').toString() !== storageRoot.toString() || !backupName.test(uri.path.split('/').at(-1) ?? '')) {
    throw new Error('Folio could not identify this DOCX backup.')
  }
  const bytes = await readLocalDocument(uri, maxBackupBytes, signal)
  const record: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!isRecord(record) || record.version !== 1 || record.uri !== document.uri.toString() ||
    !isGeneration(record.revision) || record.revision >= Number.MAX_SAFE_INTEGER || !isId(record.journalId) ||
    typeof record.source !== 'string' || typeof record.original !== 'string' || typeof record.fingerprint !== 'string' ||
    record.original.length > 4 * Math.ceil(docxMaxFileBytes / 3)) {
    throw new Error('This DOCX backup is invalid or belongs to a different document.')
  }
  const original = Uint8Array.from(Buffer.from(record.original, 'base64'))
  if (fingerprint(original) !== record.fingerprint) throw new Error('The original package in the DOCX backup failed verification.')
  const rich = readDocxSnapshot(record.source)
  const packaged = await importPackage(original, signal)
  document.install(packaged, record.source, rich)
  document.dirty = true
  document.fromBackup = true
  document.restoredBackup = uri
  document.revision = record.revision
  document.journalId = record.journalId as typeof document.journalId
}

export async function retireDocxBackup(document: DocxDocument) {
  if (!document.restoredBackup) return
  const uri = document.restoredBackup
  try {
    await vscode.workspace.fs.delete(uri, { recursive: false })
    document.restoredBackup = undefined
  } catch { /* Retain storage if VS Code cannot retire the old profile backup. */ }
}

export async function writeDocxBackup(document: DocxDocument, destination: vscode.Uri, signal: AbortSignal): Promise<vscode.CustomDocumentBackup> {
  signal.throwIfAborted()
  const original = document.original
  if (!original) throw new Error('The DOCX source package is unavailable.')
  const parent = vscode.Uri.joinPath(destination, '..')
  // VS Code owns this profile storage location. A fresh name keeps the previous backup intact until VS Code retires it.
  const uri = vscode.Uri.joinPath(parent, `folio-docx-${randomUUID()}.backup`)
  const data = Buffer.from(JSON.stringify({
    version: 1, uri: document.uri.toString(), revision: document.revision, journalId: document.journalId,
    source: document.source, fingerprint: original.fingerprint, original: Buffer.from(original.bytes).toString('base64'),
  }))
  if (data.byteLength > maxBackupBytes) throw new Error('The DOCX backup exceeds Folio’s storage limit.')
  const remove = () => Promise.resolve(vscode.workspace.fs.delete(uri, { recursive: false })).catch(() => undefined)
  await vscode.workspace.fs.createDirectory(parent)
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
