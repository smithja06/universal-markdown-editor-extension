import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { PdfLib, PdfRuntime } from '../../src/document/formats/pdf/engine'

let runtime: Promise<PdfRuntime> | undefined

/** pdf.js's Node build with its in-process worker, for unit tests and fixture validation. */
export function nodePdfRuntime() {
  runtime ??= (async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfLib
    const require = createRequire(import.meta.url)
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    return { lib }
  })()
  return runtime
}
