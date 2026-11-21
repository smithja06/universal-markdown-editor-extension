import katex from 'katex'
import 'katex/dist/katex.min.css'

export default function MathPreview({ value, block }: { value: string; block: boolean }) {
  const html = katex.renderToString(value, { displayMode: block, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 })
  return <span aria-label={'Equation ' + value} dangerouslySetInnerHTML={{ __html: html }} />
}
