import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { onQualifiedVolume } from './localVolume'
import { isLocalDocumentFile } from './localDocumentFile'
import { writeNewFile } from './newFile'
import { classifyJournal, readJournal, removeJournal, replaceVerified, ReplaceBusyError, ReplaceConflictError, type SaveJournal } from './verifiedReplace'

export type BinaryKind = 'DOCX' | 'XLSX' | 'CSV'

export const saveQualification = 'Native Save writes in place only for local files on fixed NTFS drives in Windows.'
export const rewriteLabel = 'Save and Replace'
export const saveAsLabel = 'Save New File'
export const externalRefusal = 'The file on disk changed after Folio opened it, so Folio did not save. Revert to load the current file, or export the draft as a copy.'

export function saveUnavailable(kind: BinaryKind) {
  return `${saveQualification} Folio kept your ${kind} draft. Use Export ${kind} copy to save a separate file.`
}

export function interruptedNotice(kind: BinaryKind) {
  return `A previous Folio save of this ${kind} was interrupted, so the file on disk is incomplete. Folio reopened the content you were saving as an unsaved draft. Save to finish writing it. Download original returns the version from before that save.`
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export class BinarySaveError extends Error {
  constructor(message: string, readonly conflict = false, options?: ErrorOptions) { super(message, options) }
}

export interface JournalRecovery {
  state: 'interrupted' | 'external'
  journal: SaveJournal
  disk?: string
}

/** Coordinates conditional in-place Save, new-file-only Save As and interrupted-save recovery for one binary format. */
export class BinarySaver {
  private readonly confirmed = new Set<string>()

  constructor(private readonly kind: BinaryKind, private readonly storage: vscode.Uri | undefined, private readonly limit: number) {}

  /** Desktop VS Code exposes global storage as `vscode-userdata:`, a view of the local profile directory. */
  private get journals() {
    const storage = this.storage
    if (!storage || (storage.scheme !== 'file' && storage.scheme !== 'vscode-userdata') || storage.authority) return
    return join(storage.with({ scheme: 'file' }).fsPath, 'save-journals')
  }

  async available(uri: vscode.Uri) {
    return !!this.journals && isLocalDocumentFile(uri) && await onQualifiedVolume(uri)
  }

  /**
   * Asks once per opened file version before Folio rewrites the original with its supported subset. Save As keeps the
   * original, so it asks only when the new file would leave content out.
   */
  async confirm(fingerprint: string, name: string, losses: string[], saveAs = false) {
    if (this.confirmed.has(fingerprint) || saveAs && !losses.length) return
    const listed = losses.slice(0, 8).map(item => '• ' + item.slice(0, 200))
    if (losses.length > listed.length) listed.push(`• ${losses.length - listed.length} more item(s) listed in Folio’s import notes`)
    const detail = [
      saveAs ? `Folio writes a new ${this.kind} file using its supported subset. ${name} stays unchanged.`
        : `Folio writes ${name} using its supported ${this.kind} subset and replaces the file on disk.`,
      ...(listed.length ? ['', `These parts of the original are not kept in the ${saveAs ? 'new' : 'saved'} file:`, ...listed] : []),
      ...(saveAs ? [] : ['', 'Choose Export copy in Folio instead to keep the original unchanged.']),
    ].join('\n')
    const label = saveAs ? saveAsLabel : rewriteLabel
    const title = saveAs ? `Save the Folio draft of ${name} as a new file?` : `Replace ${name} with the Folio draft?`
    const choice = await vscode.window.showWarningMessage(title, { modal: true, detail }, label)
    if (choice !== label) throw new vscode.CancellationError()
    if (!saveAs) this.confirmed.add(fingerprint)
  }

  remember(fingerprint: string) { this.confirmed.add(fingerprint) }

  /** Replaces the file only while it still has the expected fingerprint. Returns the fingerprint now on disk. */
  async replace(uri: vscode.Uri, expected: string, bytes: Uint8Array<ArrayBuffer>, token: vscode.CancellationToken) {
    const journals = this.journals
    if (!journals || !await this.available(uri)) throw new BinarySaveError(saveUnavailable(this.kind))
    try {
      const { fingerprint } = await replaceVerified(uri.fsPath, expected, bytes, {
        journalDirectory: journals, limit: this.limit,
        beforeWrite: () => { if (token.isCancellationRequested) throw new vscode.CancellationError() },
      })
      return fingerprint
    } catch (error) {
      if (error instanceof vscode.CancellationError) throw error
      if (error instanceof ReplaceConflictError) throw new BinarySaveError(error.message, true, { cause: error })
      if (error instanceof ReplaceBusyError) throw new BinarySaveError(error.message + ' Folio kept your draft.', false, { cause: error })
      throw new BinarySaveError(`Folio could not save the ${this.kind}. Your draft is kept. ${error instanceof Error ? error.message : ''}`.trim(), false, { cause: error })
    }
  }

  /** Save As publishes only new local files. An existing destination is never replaced. */
  async saveAs(destination: vscode.Uri, bytes: Uint8Array<ArrayBuffer>, extension: string) {
    if (!isLocalDocumentFile(destination) || !destination.path.toLowerCase().endsWith('.' + extension)) {
      throw new BinarySaveError(`Choose a new local .${extension} file for Save As.`)
    }
    try { await writeNewFile(destination.fsPath, bytes, `${this.kind} file`) }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      throw new BinarySaveError(/already exists/.test(message)
        ? `Folio Save As creates new files and does not replace an existing ${this.kind}. Choose a new name, or open that file in Folio and save it there.`
        : message || `VS Code could not create the ${this.kind} file.`, false, { cause: error })
    }
    return sha(bytes)
  }

  /** Classifies a leftover save journal against the file on disk. Completed and untouched journals are retired. */
  async recover(uri: vscode.Uri, current?: Uint8Array): Promise<JournalRecovery | undefined> {
    const journals = this.journals
    if (!journals || !isLocalDocumentFile(uri)) return
    let journal: SaveJournal | undefined
    try { journal = await readJournal(journals, uri.fsPath) }
    catch { return }
    if (!journal) return
    const bytes = current ?? await readFile(uri.fsPath).then(data => new Uint8Array(data), () => undefined)
    const state = classifyJournal(bytes, journal)
    if (state === 'completed' || state === 'untouched') {
      await removeJournal(journals, uri.fsPath).catch(() => undefined)
      return
    }
    return { state, journal, disk: bytes && sha(bytes) }
  }
}
