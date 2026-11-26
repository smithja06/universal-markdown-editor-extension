import type { FileInput } from '../../host/contracts'
import { decodeMarkdown, encodeMarkdown, markdownFilename, sanitizeFilename } from '../files'
import { makeDocxContent, type DocumentContent, type DocumentFormat, type DocxContent, type LineEnding, type MarkdownContent, type OriginalFile, type OriginalFileReference, type TxtContent } from './content'
import { docxMaxFileBytes, docxMimeType, type DocxCodec, type DocxIssue } from './docx/model'
import { containsBinaryControls, decodeTxt, maxTxtImportBytes, TxtInputError } from './txt'

export interface FormatDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: 'unsupported-format' | 'invalid-encoding' | 'invalid-text' | 'size-limit' | 'mixed-line-endings' | 'stale-export' | 'missing-original' | 'invalid-docx' | 'docx-fidelity'
  message: string
  feature?: string
  location?: string
  effect?: DocxIssue['effect']
}

type Rejected = { status: 'rejected'; diagnostics: [FormatDiagnostic] }
type Imported = { status: 'editable'; content: DocumentContent; diagnostics: FormatDiagnostic[]; original?: OriginalFile } | Rejected
type Prepared = { status: 'ready'; bytes: Uint8Array<ArrayBuffer> } | { status: 'needs-options'; diagnostics: [FormatDiagnostic] } |
  { status: 'needs-confirmation'; diagnostics: FormatDiagnostic[] } | Rejected
export interface ExportSnapshot { id: string; revision: number; title: string; content: DocumentContent; nativeRevision?: number }
type ExportOptions = { lineEnding?: LineEnding; confirmDocx?: boolean }
type ReadOriginal = (id: string) => Promise<Blob | undefined>

interface FormatAdapter<Content extends DocumentContent> {
  extensions: readonly string[]
  mediaType: string
  capabilities: { richText: boolean; exportCopy: boolean }
  decode(bytes: Uint8Array<ArrayBuffer>): Content | Rejected
  encode(content: Content, options: ExportOptions, readOriginal: ReadOriginal): Prepared | Promise<Prepared>
  filename(title: string): string
}

const maxTxtExportBytes = 32 * 1024 * 1024
const encoder = new TextEncoder()

function reject(code: FormatDiagnostic['code'], message: string): Rejected {
  return { status: 'rejected', diagnostics: [{ severity: 'error', code, message }] }
}

const adapters: { markdown: FormatAdapter<MarkdownContent>; txt: FormatAdapter<TxtContent> } = {
  markdown: {
    extensions: ['.md', '.markdown'], mediaType: 'text/markdown;charset=utf-8', capabilities: { richText: true, exportCopy: true },
    decode(bytes) { return { ...decodeMarkdown(bytes), format: 'markdown', schemaVersion: 1 } },
    encode(content) { return { status: 'ready', bytes: encodeMarkdown(content) } },
    filename: markdownFilename,
  },
  txt: {
    extensions: ['.txt'], mediaType: 'text/plain;charset=utf-8', capabilities: { richText: false, exportCopy: true },
    decode(bytes) {
      try { return decodeTxt(bytes) }
      catch (error) {
        if (error instanceof TxtInputError) return reject(error.code, error.message)
        throw error
      }
    },
    async encode(content, options, readOriginal) {
      if (/[\uD800-\uDFFF]/u.test(content.source) || containsBinaryControls(content.source)) {
        return reject('invalid-text', 'This draft contains invalid Unicode or binary controls and cannot be exported as TXT.')
      }
      if (!content.bom && content.source.startsWith('\ufeff')) {
        return reject('invalid-text', 'The leading U+FEFF would be read as a BOM. Remove it to export this BOM-less draft.')
      }
      let lineEnding = content.lineEnding
      if (content.mixedLineEndings) {
        const original = content.originalFile && await readOriginal(content.originalFile.id)
        if (!original) return reject('missing-original', 'The original bytes for this mixed-line-ending file are unavailable.')
        const bytes = new Uint8Array(await original.arrayBuffer())
        const decoded = adapters.txt.decode(bytes)
        if ('status' in decoded) return decoded
        if (content.source === decoded.source && content.bom === decoded.bom) return { status: 'ready', bytes }
        if (!options.lineEnding) return { status: 'needs-options', diagnostics: [{
          severity: 'warning', code: 'mixed-line-endings', message: 'The original uses mixed line endings. Choose one line ending style for this edited copy.',
        }] }
        lineEnding = options.lineEnding
      }
      const bytes = encoder.encode((content.bom ? '\ufeff' : '') + content.source.replace(/\n/g, lineEnding))
      return bytes.length <= maxTxtExportBytes ? { status: 'ready', bytes } : reject('size-limit', 'TXT exports are limited to 32 MiB.')
    },
    filename(title) {
      const name = sanitizeFilename(title)
      return /\.txt$/i.test(name) ? name : name + '.txt'
    },
  },
}

const docxAdapter = {
  extensions: ['.docx'], mediaType: docxMimeType, capabilities: { richText: true, exportCopy: true },
  filename(title: string) {
    const stem = sanitizeFilename(title.replace(/\.docx$/i, ''))
    return stem + ' copy.docx'
  },
}

function docxIssue(issue: DocxIssue): FormatDiagnostic {
  return { ...issue, code: 'docx-fidelity', severity: issue.effect === 'preserved' ? 'info' : 'warning' }
}

async function prepareDocx(content: DocxContent, options: ExportOptions, signal?: AbortSignal, codec?: DocxCodec): Promise<Prepared> {
  const diagnostics = content.issues.filter(issue => issue.effect !== 'preserved').map(docxIssue)
  diagnostics.push(docxIssue({ code: 'new-layout', effect: 'approximated', feature: 'Page layout and styles',
    message: 'The copy uses Folio’s Word styles and page defaults. Fonts, line wraps and page breaks can change.' }))
  if (!options.confirmDocx) return { status: 'needs-confirmation', diagnostics }
  if (!codec) return reject('invalid-docx', 'DOCX export is available in standalone Folio.')
  try {
    return { status: 'ready', bytes: await codec.write(content.document, signal) }
  } catch (error) {
    signal?.throwIfAborted()
    return reject('invalid-docx', error instanceof Error ? error.message : 'The DOCX copy could not be generated.')
  }
}

export const openFileTypes = [...Object.values(adapters).flatMap(adapter => adapter.extensions), ...docxAdapter.extensions, 'text/markdown', 'text/plain', docxMimeType].join(',')

export function identifyFormat(filename: string): DocumentFormat | undefined {
  const extension = /\.[^.]+$/.exec(filename.toLowerCase())?.[0]
  if (extension === '.docx') return 'docx'
  return (Object.keys(adapters) as (keyof typeof adapters)[]).find(format => extension && adapters[format].extensions.includes(extension))
}

export function formatCapabilities(content: DocumentContent) {
  return content.format === 'docx' ? docxAdapter.capabilities : adapters[content.format ?? 'markdown'].capabilities
}

export async function importDocument(input: FileInput, signal?: AbortSignal, codec?: DocxCodec): Promise<Imported> {
  const format = identifyFormat(input.name)
  if (!format) return reject('unsupported-format', 'Choose a .md, .markdown, .txt or .docx file.')
  signal?.throwIfAborted()
  if (format === 'txt' && input.size !== undefined && input.size > maxTxtImportBytes) return reject('size-limit', 'TXT imports are limited to 16 MiB.')
  if (format === 'docx' && (input.size ?? 0) > docxMaxFileBytes) return reject('size-limit', 'DOCX imports are limited to 24 MiB.')
  const bytes = new Uint8Array(await input.arrayBuffer())
  signal?.throwIfAborted()
  let content: DocumentContent | Rejected
  try {
    if (format === 'docx') {
      if (bytes.byteLength > docxMaxFileBytes) return reject('size-limit', 'DOCX imports are limited to 24 MiB.')
      if (!codec) return reject('invalid-docx', 'DOCX import is available in standalone Folio.')
      const result = await codec.read(bytes, signal)
      content = makeDocxContent(result.document, result.issues)
    } else content = adapters[format].decode(bytes)
  }
  catch (error) {
    signal?.throwIfAborted()
    if (format === 'docx') return reject('invalid-docx', error instanceof Error ? error.message : 'The DOCX package could not be opened.')
    if (!(error instanceof TypeError)) throw error
    return reject('invalid-encoding', 'The file is not valid UTF-8.')
  }
  if ('status' in content) return content
  if (content.format !== 'txt' && content.format !== 'docx') return { status: 'editable', content, diagnostics: [] }
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  signal?.throwIfAborted()
  const reference = { id: crypto.randomUUID(), filename: input.name, sha256, byteLength: bytes.length }
  return { status: 'editable', content: { ...content, originalFile: reference }, diagnostics: content.format === 'docx' ? content.issues.map(docxIssue) : [], original: { reference, bytes: new Blob([bytes]) } }
}

export async function exportDocument(snapshot: ExportSnapshot, isCurrent: (snapshot: ExportSnapshot) => boolean, readOriginal: ReadOriginal,
  deliver: (filename: string, bytes: Uint8Array<ArrayBuffer>, mediaType: string) => void, options: ExportOptions = {}, signal?: AbortSignal, codec?: DocxCodec) {
  const stale = () => reject('stale-export', 'The document changed. Start a new export from the current draft.')
  signal?.throwIfAborted()
  if (!isCurrent(snapshot)) return stale()
  const { content, title } = snapshot
  const adapter = content.format === 'docx' ? docxAdapter : adapters[content.format ?? 'markdown']
  const prepared = await (content.format === 'docx' ? prepareDocx(content, options, signal, codec)
    : content.format === 'txt' ? adapters.txt.encode(content, options, readOriginal) : adapters.markdown.encode(content, options, readOriginal))
  signal?.throwIfAborted()
  if (!isCurrent(snapshot)) return stale()
  if (prepared.status !== 'ready') return prepared
  const filename = adapter.filename(title)
  deliver(filename, prepared.bytes, adapter.mediaType)
  return { status: 'downloaded' as const, filename }
}

export async function originalFileBytes(reference: OriginalFileReference, readOriginal: ReadOriginal) {
  const original = await readOriginal(reference.id)
  if (!original || original.size !== reference.byteLength) throw new Error('The original file is unavailable.')
  return new Uint8Array(await original.arrayBuffer())
}
