import { resolve } from 'node:path'
import * as vscode from 'vscode'
import type { SpreadsheetFormat } from '../../src/document/formats/spreadsheet/model'
import { isSpreadsheetFilename } from '../../src/host/vscode/spreadsheetProtocol'
import { isLocalDocumentFile } from './localDocumentFile'
import { writeNewFile } from './newFile'

function fileKey(uri: vscode.Uri) {
  const path = resolve(uri.fsPath)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function isSameSpreadsheetFile(left: vscode.Uri, right: vscode.Uri) {
  return fileKey(left) === fileKey(right)
}

export async function saveSpreadsheetCopy(
  source: vscode.Uri, filename: string, format: SpreadsheetFormat | 'png', bytes: Uint8Array,
  stillCurrent: () => boolean, original: boolean,
) {
  const type = format.toUpperCase()
  const label = original ? `Save original ${type} copy` : `Save ${type} copy`
  const name = isSpreadsheetFilename(filename, format) ? filename : `Workbook copy.${format}`
  const target = await vscode.window.showSaveDialog({
    title: label,
    saveLabel: label,
    filters: { [type]: [format] },
    defaultUri: vscode.Uri.joinPath(source, '..', name),
  })
  if (!target) return { status: 'cancelled' as const }
  const chosen = target.path.split('/').at(-1)
  if (!isLocalDocumentFile(target) || !isSpreadsheetFilename(chosen, format)) {
    throw new Error(`Choose a valid local .${format} filename for the copy.`)
  }
  if (isSameSpreadsheetFile(source, target)) throw new Error('Choose a different filename to preserve the opened workbook.')
  if (!stillCurrent()) throw new Error('The workbook changed while you chose a destination. Start a new export.')
  await writeNewFile(target.fsPath, bytes, original ? 'original workbook copy' : `${type} copy`)
  return { status: 'saved' as const, name: chosen }
}
