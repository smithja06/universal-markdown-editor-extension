/// <reference lib="webworker" />
// pdfmake's prebuilt browser bundle. See docs/extension-distribution.md#phase-8-pdf-dependencies for its embedded components.
import pdfMakeBundle from 'pdfmake/build/pdfmake.min.js'
import type { PdfPageOptions, PrintDocument } from './model'
import { renderPdf, type FontData, type PdfMakeLike } from './render'

export interface GeneratorRequest { print: PrintDocument; options: PdfPageOptions; fonts: FontData }
export type GeneratorReply = { bytes: ArrayBuffer } | { error: string }

const pdfMake = pdfMakeBundle as unknown as PdfMakeLike
const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async ({ data }: MessageEvent<GeneratorRequest>) => {
  try {
    const bytes = await renderPdf(pdfMake, data.print, data.options, data.fonts)
    scope.postMessage({ bytes: bytes.buffer } satisfies GeneratorReply, [bytes.buffer])
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message.slice(0, 500) : 'The PDF could not be generated.' } satisfies GeneratorReply)
  }
}
