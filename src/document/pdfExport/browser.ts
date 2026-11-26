import GeneratorWorker from './generator.worker.ts?worker&inline'
import { browserPdfRuntime } from '../formats/pdf/engine'
import { renderDiagram } from '../diagrams'
import { exportFonts } from './fonts'
import type { GeneratorReply, GeneratorRequest } from './generator.worker'
import { missingGlyphs } from './layout'
import { codePointMarker } from './coverage'
import type { MarkdownAssets, RasterAsset } from './fromMarkdown'
import { blockText, documentLanguage, exportLimits, type ExportNotice, type PdfPageOptions, type PrintBlock, type PrintDocument } from './model'
import { fontSetCoverage } from './render'
import { validatePdf, type PdfValidation } from './validate'

let coverage: ReturnType<typeof fontSetCoverage> | undefined
const fontCoverage = () => coverage ??= fontSetCoverage(exportFonts)

function countBlocks(blocks: PrintBlock[]): number {
  return blocks.reduce((total, block) => total + 1 + (block.kind === 'list' ? block.items.reduce((sum, item) => sum + countBlocks(item.blocks), 0)
    : block.kind === 'quote' ? countBlocks(block.blocks) : block.kind === 'table' ? block.rows.length : 0), 0)
}

/** Notices that depend on the bundled fonts and export limits. Shown before the PDF is generated. */
export function reviewNotices(print: PrintDocument): ExportNotice[] {
  const characters = print.blocks.reduce((total, block) => total + blockText(block).length, 0)
  if (characters > exportLimits.characters) throw new Error(`PDF export is limited to ${exportLimits.characters.toLocaleString('en-US')} characters of text.`)
  if (countBlocks(print.blocks) > exportLimits.blocks) throw new Error('This document has too many blocks for PDF export.')
  const missing = missingGlyphs(print, fontCoverage())
  if (!missing.size) return print.notices
  const total = [...missing.values()].reduce((sum, count) => sum + count, 0)
  const sample = [...missing.keys()].slice(0, 12).join(' ')
  return [...print.notices, { feature: 'Characters and fonts', effect: 'approximated',
    message: `${total.toLocaleString('en-US')} character${total === 1 ? '' : 's'} (${sample}${missing.size > 12 ? ' …' : ''}) have no glyph in Folio’s bundled PDF fonts. They print as Unicode code points such as ${codePointMarker([...missing.keys()].slice(0, 1))}, which stay searchable.` }]
}

function generate(request: GeneratorRequest, signal?: AbortSignal) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new GeneratorWorker()
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { finish(); reject(new DOMException('PDF export was cancelled.', 'AbortError')) }
    const timer = setTimeout(() => { finish(); reject(new Error('PDF generation exceeded its time limit.')) }, exportLimits.generateTimeoutMs)
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<GeneratorReply>) => {
      finish()
      if ('error' in data) reject(new Error(data.error))
      else resolve(new Uint8Array(data.bytes))
    }
    worker.onerror = () => { finish(); reject(new Error('The PDF generator stopped unexpectedly.')) }
    worker.postMessage(request)
  })
}

/** Generates a PDF in an isolated worker, then reopens it with the viewer engine to validate it. */
export async function createPdf(input: PrintDocument, options: PdfPageOptions, signal?: AbortSignal): Promise<{ bytes: Uint8Array; validation: PdfValidation }> {
  // Without a declared language, assistive technology reads the PDF in the reader's locale.
  const print = { ...input, language: input.language ?? documentLanguage(globalThis.navigator?.language) }
  const bytes = await generate({ print, options, fonts: exportFonts }, signal)
  signal?.throwIfAborted()
  const validation = await validatePdf(bytes, print, options, fontCoverage(), await browserPdfRuntime(), signal)
  return { bytes, validation }
}

const pointsPerPixel = 0.75
const maxRasterSide = 6000

function decodeImage(url: string, signal?: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const abort = () => { image.src = ''; reject(new DOMException('Cancelled', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    image.onload = () => { signal?.removeEventListener('abort', abort); resolve(image) }
    image.onerror = () => { signal?.removeEventListener('abort', abort); reject(new Error('The image could not be decoded.')) }
    image.src = url
  })
}

/** Converts a local data URL to a PNG or JPEG raster that pdfmake can embed. */
export async function rasterAsset(url: string, signal?: AbortSignal, scale = 1): Promise<RasterAsset | undefined> {
  if (!/^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(url) || url.length > exportLimits.imageBytes * 1.4) return
  const image = await decodeImage(url, signal)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height || width > maxRasterSide || height > maxRasterSide) return
  if (/^data:image\/(?:png|jpeg);base64,/i.test(url) && scale === 1) return { src: url, width: width * pointsPerPixel, height: height * pointsPerPixel }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) return
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const src = canvas.toDataURL('image/png')
  canvas.width = 0
  canvas.height = 0
  return { src, width: width * pointsPerPixel, height: height * pointsPerPixel }
}

let diagramId = 0

/** Local image and diagram sources. Remote URLs are never fetched. */
export function browserAssets(workspaceImage?: (reference: string, signal: AbortSignal) => Promise<string | undefined>): MarkdownAssets {
  let bytes = 0
  const bounded = async (asset: RasterAsset | undefined) => {
    if (!asset) return
    bytes += asset.src.length * 0.75
    return bytes > exportLimits.totalImageBytes ? undefined : asset
  }
  return {
    async image(src, signal) {
      if (/^data:/i.test(src)) return bounded(await rasterAsset(src, signal))
      if (!workspaceImage || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) return
      const controller = new AbortController()
      const data = await workspaceImage(src, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal)
      return data ? bounded(await rasterAsset(data, signal)) : undefined
    },
    async diagram(source, signal) {
      const svg = await renderDiagram('folio-pdf-diagram-' + ++diagramId, source, { mode: 'export', signal })
      if (!svg) return
      // Raster images isolate diagram markup from the PDF. Scale 2 keeps text legible when printed.
      return bounded(await rasterAsset('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), signal, 2))
    },
  }
}
