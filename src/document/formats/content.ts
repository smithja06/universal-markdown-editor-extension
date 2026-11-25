import type { MarkdownFile } from '../files'
import type { JSONContent } from '@tiptap/core'
import { canonicalDocx, docxText, type DocxIssue } from './docx/model'

export type DocumentFormat = 'markdown' | 'txt' | 'docx'
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

export interface DocxContent {
  format: 'docx'
  schemaVersion: 1
  document: JSONContent
  issues: DocxIssue[]
  // A text index for the shared library, never the authoritative rich document.
  source: string
  lineEnding: '\n'
  bom: false
  originalFile?: OriginalFileReference
  original?: never
}

// The discriminator also accepts untagged Markdown records.
export type DocumentContent = MarkdownContent | TxtContent | DocxContent

export function makeDocxContent(input: JSONContent, issues: DocxIssue[]): DocxContent {
  const document = canonicalDocx(input)
  return { format: 'docx', schemaVersion: 1, document, issues, source: docxText(document), lineEnding: '\n', bom: false }
}

export function originalReference(content: DocumentContent) {
  return content.format === 'txt' || content.format === 'docx' ? content.originalFile : undefined
}

export function newTextContent(): TxtContent {
  return { format: 'txt', schemaVersion: 1, source: '', bom: false, lineEnding: '\n', mixedLineEndings: false }
}

export function sameLineage(left: DocumentContent, right: DocumentContent) {
  if ((left.format ?? 'markdown') !== (right.format ?? 'markdown')) return false
  if (left.format === 'txt' || left.format === 'docx') {
    return left.schemaVersion === right.schemaVersion && originalReference(left)?.id === originalReference(right)?.id
  }
  return true
}

export function sameContent(left: DocumentContent, right: DocumentContent) {
  if (left === right) return true
  if (!sameLineage(left, right)) return false
  if (left.source !== right.source || left.bom !== right.bom || left.lineEnding !== right.lineEnding) return false
  if (left.format === 'docx' || right.format === 'docx') {
    return left.format === 'docx' && right.format === 'docx' && JSON.stringify(left.document) === JSON.stringify(right.document) &&
      JSON.stringify(left.issues) === JSON.stringify(right.issues)
  }
  if (left.format === 'txt' || right.format === 'txt') {
    return left.format === 'txt' && right.format === 'txt' && left.mixedLineEndings === right.mixedLineEndings
  }
  return (left.original?.source === left.source ? left.original.text : undefined) ===
    (right.original?.source === right.source ? right.original.text : undefined)
}
