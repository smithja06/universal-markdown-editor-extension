import katexCss from 'katex/dist/katex.min.css?raw'
import interCss from '@fontsource-variable/inter/index.css?raw'

const fonts = import.meta.glob<string>([
  '/node_modules/katex/dist/fonts/*.woff2',
  '/node_modules/@fontsource-variable/inter/files/*-wght-normal.woff2',
], { query: '?url&inline', import: 'default', eager: true, exhaustive: true })

export function fontStyles({ math, inter }: { math: boolean; inter: boolean }) {
  const inlineFont = (directory: string, filename: string) => {
    const font = fonts[`${directory}/${filename}`]
    if (!font?.startsWith('data:')) throw new Error(`Unable to embed font ${filename}.`)
    return `url("${font}") format("woff2")`
  }
  // One WOFF2 per face is sufficient for browsers that can run Folio.
  const mathStyles = math ? katexCss.replace(/src:url\(fonts\/([^)]*\.woff2)\)[^}]*}/g,
    (_, filename: string) => `src:${inlineFont('/node_modules/katex/dist/fonts', filename)}}`) : ''
  const textStyles = inter ? interCss.replace(/url\(\.\/files\/([^)]*\.woff2)\)\s*format\('[^']+'\)/g,
    (_, filename: string) => inlineFont('/node_modules/@fontsource-variable/inter/files', filename)) : ''
  return '\n' + mathStyles + '\n' + textStyles
}
