import type { MarkdownFile } from '../files'

export type DocumentFormat = 'markdown' | 'txt'
export type LineEnding = MarkdownFile['lineEnding']

export interface OriginalFileReference {
  id: string
  filename: string
  sha256: string
  byteLength: number
}

export interface OriginalFile {
  reference: OriginalFileReference
  bytes: Blob
}

export interface MarkdownContent extends MarkdownFile {
  format?: 'markdown'
  schemaVersion?: 1
}

export interface TxtContent {
  format: 'txt'
  schemaVersion: 1
  source: string
  bom: boolean
  lineEnding: LineEnding
  mixedLineEndings: boolean
  originalFile?: OriginalFileReference
  original?: never
}

// Both current formats are text-based. The discriminator also accepts untagged Markdown records.
export type DocumentContent = MarkdownContent | TxtContent

export function newTextContent(): TxtContent {
  return { format: 'txt', schemaVersion: 1, source: '', bom: false, lineEnding: '\n', mixedLineEndings: false }
}

export function sameLineage(left: DocumentContent, right: DocumentContent) {
  if (left.format === 'txt' || right.format === 'txt') {
    return left.format === 'txt' && right.format === 'txt' && left.schemaVersion === right.schemaVersion && left.originalFile?.id === right.originalFile?.id
  }
  return true
}

export function sameContent(left: DocumentContent, right: DocumentContent) {
  if (left.source !== right.source || left.bom !== right.bom || left.lineEnding !== right.lineEnding) return false
  if (!sameLineage(left, right)) return false
  if (left.format === 'txt' || right.format === 'txt') {
    return left.format === 'txt' && right.format === 'txt' && left.mixedLineEndings === right.mixedLineEndings
  }
  return (left.original?.source === left.source ? left.original.text : undefined) ===
    (right.original?.source === right.source ? right.original.text : undefined)
}
