export const pdfMimeType = 'application/pdf'

/** Documented Phase 8 resource bounds. See docs/phase-8-pdf.md#security-and-resource-limits. */
export const pdfLimits = {
  /** Standalone import, VS Code viewing and the webview transfer. */
  fileBytes: 64 * 1024 * 1024,
  pages: 2000,
  /** Embedded images above this pixel count are skipped by the renderer. */
  imagePixels: 40_000_000,
  /** Device pixels for one page canvas. Larger zooms render at a reduced output scale. */
  canvasPixels: 16_777_216,
  concurrentRenders: 2,
  /** Rendered pages kept outside the viewport before their canvases are released. */
  retainedPages: 6,
  pageTextCharacters: 200_000,
  documentTextCharacters: 8_000_000,
  openTimeoutMs: 30_000,
  pageTimeoutMs: 20_000,
  minZoom: 0.25,
  maxZoom: 4,
} as const

export type PdfInputCode = 'invalid-pdf' | 'encrypted' | 'size-limit' | 'page-limit' | 'timeout'

export class PdfInputError extends Error {
  constructor(readonly code: PdfInputCode, message: string) { super(message) }
}

export interface PdfFeatures {
  forms: boolean
  xfa: boolean
  scripts: boolean
  attachments: boolean
  signatures: boolean
  encryptedWithoutPassword: boolean
}

export interface PdfSummary {
  pageCount: number
  title?: string
  features: PdfFeatures
}

/** Reasons Folio displays with an opened PDF. Each states what Folio does with the content. */
export function pdfNotices(features: PdfFeatures) {
  const notices: string[] = []
  if (features.scripts) notices.push('This PDF contains JavaScript or automatic actions. Folio does not run them.')
  if (features.forms || features.xfa) notices.push('Form fields are shown as page content and cannot be filled in Folio.')
  if (features.attachments) notices.push('Embedded attachments are kept in the original file and are not opened.')
  if (features.signatures) notices.push('Digital signatures are not verified by Folio.')
  if (features.encryptedWithoutPassword) notices.push('This PDF has permission restrictions. Folio displays it read-only.')
  return notices
}

/** Checks the PDF header and trailer without parsing the file. */
export function looksLikePdf(bytes: Uint8Array) {
  const head = bytes.subarray(0, 1024)
  for (let offset = 0; offset + 5 <= head.length; offset++) {
    if (head[offset] === 0x25 && head[offset + 1] === 0x50 && head[offset + 2] === 0x44 && head[offset + 3] === 0x46 && head[offset + 4] === 0x2d) return true
  }
  return false
}

export type PdfInspector = (bytes: Uint8Array, signal?: AbortSignal) => Promise<PdfSummary>

export function pdfSizeError(size: number) {
  return size > pdfLimits.fileBytes ? new PdfInputError('size-limit', `PDF files are limited to ${pdfLimits.fileBytes / 1024 / 1024} MiB.`) : undefined
}
