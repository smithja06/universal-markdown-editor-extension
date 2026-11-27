import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import { looksLikePdf, pdfLimits, PdfInputError, type PdfSummary } from './model'
import { pageText, type PdfPageText } from './text'

export type PdfLib = typeof import('pdfjs-dist')
export interface PdfRuntime {
  lib: PdfLib
  /** Creates an isolated pdf.js worker. Node tests use pdf.js's in-process fallback. */
  createPort?: () => Worker
}

export interface PdfHandle extends PdfSummary {
  readonly document: PDFDocumentProxy
  page(index: number): Promise<PDFPageProxy>
  text(index: number, signal?: AbortSignal): Promise<PdfPageText>
  /** The pdf.js text content behind `text()`, for the selectable text layer. */
  content(index: number, signal?: AbortSignal): Promise<TextContent>
  readonly destroyed: boolean
  destroy(): Promise<void>
}

let browserRuntime: Promise<PdfRuntime> | undefined

/**
 * Loads pdf.js and its worker only when a PDF is opened or validated. pdf.js's legacy build carries polyfills for APIs
 * its modern build requires, such as Math.sumPrecise and Uint8Array.fromBase64, which VS Code 1.100's Chromium 132 lacks.
 */
export function browserPdfRuntime() {
  browserRuntime ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('./pdfjsWorker')])
    .then(([lib, worker]) => ({ lib: lib as unknown as PdfLib, createPort: worker.createPdfjsWorker }))
    .catch(error => { browserRuntime = undefined; throw error })
  return browserRuntime
}

function timeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal | undefined, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PdfInputError('timeout', message)), ms)
    const abort = () => reject(signal?.reason instanceof Error ? signal.reason : new DOMException('PDF processing was cancelled.', 'AbortError'))
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    })
  })
}

const entries = (value: unknown) => value instanceof Map ? value.size : value && typeof value === 'object' ? Object.keys(value).length : 0

function inputError(error: unknown) {
  if (error instanceof PdfInputError) return error
  const name = (error as { name?: string })?.name
  if (name === 'PasswordException') return new PdfInputError('encrypted', 'This PDF is password-protected. Folio does not open encrypted PDFs that require a password.')
  return new PdfInputError('invalid-pdf', 'The file is not a readable PDF document.')
}

export async function openPdf(bytes: Uint8Array, runtime: PdfRuntime, signal?: AbortSignal): Promise<PdfHandle> {
  signal?.throwIfAborted()
  if (bytes.byteLength > pdfLimits.fileBytes) throw new PdfInputError('size-limit', `PDF files are limited to ${pdfLimits.fileBytes / 1024 / 1024} MiB.`)
  if (!looksLikePdf(bytes)) throw new PdfInputError('invalid-pdf', 'The file does not start with a PDF header.')
  const { lib } = runtime
  const port = runtime.createPort?.()
  const worker = port ? new lib.PDFWorker({ port: port as unknown as null }) : undefined
  // pdf.js transfers typed arrays to its worker, so keep the caller's original intact.
  const task = lib.getDocument({
    data: bytes.slice(), worker, verbosity: 0,
    useWasm: false, useWorkerFetch: false, enableXfa: false, disableWorkerRendering: true,
    disableRange: true, disableStream: true, disableAutoFetch: true, maxImageSize: pdfLimits.imagePixels,
    canvasMaxAreaInBytes: pdfLimits.canvasPixels * 4,
  })
  let destroyed = false
  const release = async () => {
    if (destroyed) return
    destroyed = true
    await task.destroy().catch(() => undefined)
    worker?.destroy()
    port?.terminate()
  }
  const rejected = new Promise<never>((_, reject) => {
    task.onPassword = () => reject(new PdfInputError('encrypted', 'This PDF is password-protected. Folio does not open encrypted PDFs that require a password.'))
  })
  try {
    const document = await timeout(Promise.race([task.promise, rejected]), pdfLimits.openTimeoutMs, signal, 'The PDF took too long to open.')
    if (document.numPages < 1) throw new PdfInputError('invalid-pdf', 'The PDF has no pages.')
    if (document.numPages > pdfLimits.pages) throw new PdfInputError('page-limit', `Folio opens PDFs with up to ${pdfLimits.pages.toLocaleString('en-US')} pages.`)
    const [metadata, scripts, attachments] = await timeout(Promise.all([
      document.getMetadata().catch(() => undefined),
      document.getJSActions().catch(() => null),
      document.getAttachments().catch(() => null),
    ]), pdfLimits.openTimeoutMs, signal, 'The PDF took too long to open.')
    const info = (metadata?.info ?? {}) as Record<string, unknown>
    const title = typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim().slice(0, 300) : undefined
    const texts = new Map<number, Promise<{ content: TextContent; text: PdfPageText }>>()
    let extracted = 0
    const extract = (index: number) => {
      let entry = texts.get(index)
      if (!entry) {
        entry = (async () => {
          const page = await handle.page(index)
          const content = await page.getTextContent({ includeMarkedContent: false })
          const budget = Math.min(pdfLimits.pageTextCharacters, pdfLimits.documentTextCharacters - extracted)
          const text = pageText(index, content.items, Math.max(0, budget))
          extracted += text.text.length
          return { content, text }
        })()
        texts.set(index, entry)
        entry.catch(() => texts.delete(index))
      }
      return entry
    }
    const handle: PdfHandle = {
      document, pageCount: document.numPages, title,
      features: {
        forms: info.IsAcroFormPresent === true, xfa: info.IsXFAPresent === true,
        scripts: entries(scripts) > 0, attachments: entries(attachments) > 0,
        signatures: info.IsSignaturesPresent === true, encryptedWithoutPassword: typeof info.EncryptFilterName === 'string',
      },
      get destroyed() { return destroyed },
      page(index) {
        if (destroyed) return Promise.reject(new Error('The PDF was closed.'))
        return document.getPage(index + 1)
      },
      text(index, textSignal) {
        return timeout(extract(index).then(result => result.text), pdfLimits.pageTimeoutMs, textSignal, 'Text extraction took too long on this page.')
      },
      content(index, textSignal) {
        return timeout(extract(index).then(result => result.content), pdfLimits.pageTimeoutMs, textSignal, 'Text extraction took too long on this page.')
      },
      destroy: release,
    }
    return handle
  } catch (error) {
    await release()
    signal?.throwIfAborted()
    throw inputError(error)
  }
}

/** Validates a PDF and returns its summary, then releases all pdf.js resources. */
export async function inspectPdf(bytes: Uint8Array, runtime: PdfRuntime, signal?: AbortSignal): Promise<PdfSummary> {
  const handle = await openPdf(bytes, runtime, signal)
  try {
    // Parse the first page so a damaged page tree fails at import rather than in the viewer.
    await timeout(handle.page(0), pdfLimits.pageTimeoutMs, signal, 'The PDF took too long to open.')
    return { pageCount: handle.pageCount, title: handle.title, features: handle.features }
  } catch (error) {
    signal?.throwIfAborted()
    throw inputError(error)
  } finally { await handle.destroy() }
}
