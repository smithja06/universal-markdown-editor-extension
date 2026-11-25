import type { FileInput } from '../../host/contracts'
import { decodeMarkdown, encodeMarkdown, markdownFilename, sanitizeFilename } from '../files'
import { newTextContent, type DocumentContent, type DocumentFormat, type LineEnding, type MarkdownContent, type OriginalFile, type OriginalFileReference, type TxtContent } from './content'

export interface FormatDiagnostic {
  severity: 'warning' | 'error'
  code: 'unsupported-format' | 'invalid-encoding' | 'invalid-text' | 'size-limit' | 'mixed-line-endings' | 'stale-export' | 'missing-original'
  message: string
}

type Rejected = { status: 'rejected'; diagnostics: [FormatDiagnostic] }
type Imported = { status: 'editable'; content: DocumentContent; diagnostics: FormatDiagnostic[]; original?: OriginalFile } | Rejected
type Prepared = { status: 'ready'; bytes: Uint8Array<ArrayBuffer> } | { status: 'needs-options'; diagnostics: [FormatDiagnostic] } | Rejected
export interface ExportSnapshot { id: string; revision: number; title: string; content: DocumentContent }
type ExportOptions = { lineEnding?: LineEnding }
type ReadOriginal = (id: string) => Promise<Blob | undefined>

interface FormatAdapter<Content extends DocumentContent> {
  extensions: readonly string[]
  mediaType: string
  capabilities: { richText: boolean; exportCopy: boolean }
  decode(bytes: Uint8Array<ArrayBuffer>): Content | Rejected
  encode(content: Content, options: ExportOptions, readOriginal: ReadOriginal): Prepared | Promise<Prepared>
  filename(title: string): string
}

const maxTxtImportBytes = 16 * 1024 * 1024
const maxTxtExportBytes = 32 * 1024 * 1024
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()

function reject(code: FormatDiagnostic['code'], message: string): Rejected {
  return { status: 'rejected', diagnostics: [{ severity: 'error', code, message }] }
}

// Tabs, newlines, vertical tabs and form feeds are valid plain-text whitespace.
function containsBinaryControls(text: string) {
  // eslint-disable-next-line no-control-regex -- Reject binary-looking controls, preserving text whitespace.
  return /[\x00-\x08\x0e-\x1f\x7f]/.test(text)
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
      if (bytes.length > maxTxtImportBytes) return reject('size-limit', 'TXT imports are limited to 16 MiB.')
      const text = utf8.decode(bytes)
      const bom = text.startsWith('\ufeff')
      const body = bom ? text.slice(1) : text
      if (containsBinaryControls(body)) return reject('invalid-text', 'The file appears to contain binary data.')
      const lineEnding = (body.match(/\r\n|\r|\n/)?.[0] as LineEnding | undefined) ?? '\n'
      const source = body.replace(/\r\n?/g, '\n')
      return { ...newTextContent(), source, bom, lineEnding, mixedLineEndings: source.replace(/\n/g, lineEnding) !== body }
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

export const openFileTypes = Object.values(adapters).flatMap(adapter => adapter.extensions).join(',') + ',text/markdown,text/plain'

export function identifyFormat(filename: string): DocumentFormat | undefined {
  const extension = /\.[^.]+$/.exec(filename.toLowerCase())?.[0]
  return (Object.keys(adapters) as DocumentFormat[]).find(format => extension && adapters[format].extensions.includes(extension))
}

export function formatCapabilities(content: DocumentContent) {
  return adapters[content.format ?? 'markdown'].capabilities
}

export async function importDocument(input: FileInput, signal?: AbortSignal): Promise<Imported> {
  const format = identifyFormat(input.name)
  if (!format) return reject('unsupported-format', 'Choose a .md, .markdown or .txt file.')
  signal?.throwIfAborted()
  if (format === 'txt' && input.size !== undefined && input.size > maxTxtImportBytes) return reject('size-limit', 'TXT imports are limited to 16 MiB.')
  const bytes = new Uint8Array(await input.arrayBuffer())
  signal?.throwIfAborted()
  let content: DocumentContent | Rejected
  try { content = adapters[format].decode(bytes) }
  catch (error) {
    if (!(error instanceof TypeError)) throw error
    return reject('invalid-encoding', 'The file is not valid UTF-8.')
  }
  if ('status' in content) return content
  if (content.format !== 'txt') return { status: 'editable', content, diagnostics: [] }
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  signal?.throwIfAborted()
  const reference = { id: crypto.randomUUID(), filename: input.name, sha256, byteLength: bytes.length }
  return { status: 'editable', content: { ...content, originalFile: reference }, diagnostics: [], original: { reference, bytes: new Blob([bytes]) } }
}

export async function exportDocument(snapshot: ExportSnapshot, isCurrent: (snapshot: ExportSnapshot) => boolean, readOriginal: ReadOriginal,
  deliver: (filename: string, bytes: Uint8Array<ArrayBuffer>, mediaType: string) => void, options: ExportOptions = {}, signal?: AbortSignal) {
  const stale = () => reject('stale-export', 'The document changed. Start a new export from the current draft.')
  signal?.throwIfAborted()
  if (!isCurrent(snapshot)) return stale()
  const { content, title } = snapshot
  const adapter = adapters[content.format ?? 'markdown']
  const prepared = await (content.format === 'txt' ? adapters.txt.encode(content, options, readOriginal) : adapters.markdown.encode(content, options, readOriginal))
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
