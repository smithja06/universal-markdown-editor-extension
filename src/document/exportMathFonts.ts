import css from 'katex/dist/katex.min.css?raw'

const fonts = import.meta.glob<string>('/node_modules/katex/dist/fonts/*.woff2', {
  query: '?url&inline', import: 'default', eager: true, exhaustive: true,
})

export function mathFontStyles() {
  return css.replace(/src:url\(fonts\/([^)]*\.woff2)\)[^}]*}/g, (_, filename: string) => {
    const font = fonts[`/node_modules/katex/dist/fonts/${filename}`]
    if (!font?.startsWith('data:')) throw new Error(`Unable to embed font ${filename}.`)
    return `src:url("${font}") format("woff2")}`
  })
}
