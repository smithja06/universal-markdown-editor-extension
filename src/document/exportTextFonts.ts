import upright from '@fontsource-variable/inter/index.css?raw'
import italic from '@fontsource-variable/inter/wght-italic.css?raw'

const fonts = import.meta.glob<string>('/node_modules/@fontsource-variable/inter/files/*-wght-{normal,italic}.woff2', {
  query: '?url&inline', import: 'default', eager: true, exhaustive: true,
})

/** Inter's upright and italic faces, embedded so exported copies render emphasis without network fonts. */
export function textFontStyles() {
  return (upright + '\n' + italic).replace(/url\(\.\/files\/([^)]*\.woff2)\)\s*format\('[^']+'\)/g, (_, filename: string) => {
    const font = fonts[`/node_modules/@fontsource-variable/inter/files/${filename}`]
    if (!font?.startsWith('data:')) throw new Error(`Unable to embed font ${filename}.`)
    return `url("${font}") format("woff2")`
  })
}
