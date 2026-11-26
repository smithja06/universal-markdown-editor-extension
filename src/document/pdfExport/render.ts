import { fontCoverage } from './coverage'
import { fontFiles, layoutPdf, type Coverage } from './layout'
import { exportLimits, type PdfPageOptions, type PrintDocument } from './model'

/** The pdfmake surface Folio uses. The browser bundle and the Node package both provide it. */
export interface PdfMakeLike {
  createPdf(definition: object): { getBuffer(): Promise<Uint8Array> }
  setUrlAccessPolicy(policy: (url: string) => boolean): void
  addFonts(fonts: object): void
  addVirtualFileSystem?(files: Record<string, string>): void
  sharedVirtualfs?: { writeFileSync(name: string, data: string, encoding: string): void }
}

/** Base64 TrueType files keyed by the names in `fontFiles`. */
export type FontData = Record<string, string>

export function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function fontSetCoverage(fonts: FontData): Coverage {
  return { body: fontCoverage(decodeBase64(fonts['Roboto-Regular.ttf'])), mono: fontCoverage(decodeBase64(fonts['DejaVuSansMono.ttf'])),
    symbols: fontCoverage(decodeBase64(fonts['DejaVuSans.ttf'])) }
}

export async function renderPdf(pdfMake: PdfMakeLike, print: PrintDocument, options: PdfPageOptions, fonts: FontData, coverage = fontSetCoverage(fonts)) {
  // Images arrive as validated data URLs. pdfmake must never fetch a URL.
  pdfMake.setUrlAccessPolicy(() => false)
  if (pdfMake.addVirtualFileSystem) pdfMake.addVirtualFileSystem(fonts)
  else for (const [name, data] of Object.entries(fonts)) pdfMake.sharedVirtualfs?.writeFileSync(name, data, 'base64')
  pdfMake.addFonts(fontFiles)
  const bytes = new Uint8Array(await pdfMake.createPdf(layoutPdf(print, options, coverage)).getBuffer())
  if (bytes.byteLength > exportLimits.outputBytes) throw new Error('The generated PDF exceeds Folio’s export size limit.')
  return bytes
}
