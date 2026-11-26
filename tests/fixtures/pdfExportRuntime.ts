import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { FontData, PdfMakeLike } from '../../src/document/pdfExport/render'

const require = createRequire(import.meta.url)

/** Font files and pdfmake's Node build, for generating PDFs in unit tests. */
export function nodePdfMake() {
  const fonts: FontData = {}
  for (const name of ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Italic.ttf', 'Roboto-MediumItalic.ttf']) {
    fonts[name] = readFileSync(require.resolve('pdfmake/fonts/Roboto/' + name)).toString('base64')
  }
  fonts['DejaVuSansMono.ttf'] = readFileSync(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf')).toString('base64')
  const pdfMake = require('pdfmake') as PdfMakeLike & { setLocalAccessPolicy(policy: () => boolean): void }
  pdfMake.setLocalAccessPolicy(() => false)
  return { pdfMake, fonts }
}
