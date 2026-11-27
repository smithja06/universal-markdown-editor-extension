// Fonts are embedded in this lazy chunk so export never fetches a resource under the webview CSP.
import robotoRegular from 'pdfmake/fonts/Roboto/Roboto-Regular.ttf?inline'
import robotoMedium from 'pdfmake/fonts/Roboto/Roboto-Medium.ttf?inline'
import robotoItalic from 'pdfmake/fonts/Roboto/Roboto-Italic.ttf?inline'
import robotoMediumItalic from 'pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf?inline'
import dejaVuMono from 'dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?inline'
import dejaVuSans from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?inline'
import type { FontData } from './render'

const base64 = (url: string) => url.slice(url.indexOf(',') + 1)

export const exportFonts: FontData = {
  'Roboto-Regular.ttf': base64(robotoRegular),
  'Roboto-Medium.ttf': base64(robotoMedium),
  'Roboto-Italic.ttf': base64(robotoItalic),
  'Roboto-MediumItalic.ttf': base64(robotoMediumItalic),
  'DejaVuSansMono.ttf': base64(dejaVuMono),
  'DejaVuSans.ttf': base64(dejaVuSans),
}
