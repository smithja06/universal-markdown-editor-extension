import css from '@fontsource-variable/inter/index.css?raw'

const fonts = import.meta.glob<string>('/node_modules/@fontsource-variable/inter/files/*-wght-normal.woff2', {
  query: '?url&inline', import: 'default', eager: true, exhaustive: true,
})

export function textFontStyles() {
  return css.replace(/url\(\.\/files\/([^)]*\.woff2)\)\s*format\('[^']+'\)/g, (_, filename: string) => {
    const font = fonts[`/node_modules/@fontsource-variable/inter/files/${filename}`]
    if (!font?.startsWith('data:')) throw new Error(`Unable to embed font ${filename}.`)
    return `url("${font}") format("woff2")`
  })
}
