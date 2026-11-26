import * as vscode from 'vscode'
import { looksLikePdf } from '../../src/document/formats/pdf/model'
import { isLocalDocumentFile } from './localDocumentFile'
import { writeNewFile } from './newFile'

/**
 * Saves a reviewed PDF as a new local file chosen in VS Code's save dialog.
 * The file is created exclusively, so an existing file is never replaced, and its bytes are read back before success.
 * `stillCurrent` rechecks the source revision after the dialog closes.
 */
export async function savePdfCopy(source: vscode.Uri, filename: string, bytes: Uint8Array, stillCurrent: () => boolean) {
  if (!looksLikePdf(bytes)) throw new Error('The generated PDF is invalid and was not saved.')
  const folder = isLocalDocumentFile(source) ? vscode.Uri.joinPath(source, '..') : undefined
  const target = await vscode.window.showSaveDialog({
    title: 'Save PDF copy', saveLabel: 'Save PDF copy', filters: { PDF: ['pdf'] },
    defaultUri: folder ? vscode.Uri.joinPath(folder, filename) : undefined,
  })
  if (!target) return { status: 'cancelled' as const }
  if (!isLocalDocumentFile(target) || !/\.pdf$/i.test(target.path)) throw new Error('Folio saves PDF copies as new .pdf files on the local file system.')
  if (!stillCurrent()) throw new Error('The document changed while you chose a destination. Export the PDF again from the current revision.')
  await writeNewFile(target.fsPath, bytes)
  return { status: 'saved' as const, name: target.path.split('/').at(-1) ?? filename }
}
