import type { Diagnostic } from '@codemirror/lint'
import type { Nodes } from 'mdast'
import { markdownProcessor } from '../document/markdown'
import { readMetadata } from '../document/metadata'

interface Opening { token: string; from: number }
interface Range { start: number; end: number }

function scanSource(text: string, html: Range[] = []): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const yamlMatch = /^---[ \t]*\n([\s\S]*?)^---[ \t]*(?:\n|$)/m.exec(text)
  const yaml = yamlMatch?.index === 0 ? yamlMatch : null
  if (yaml) {
    const error = readMetadata(yaml[1]).error
    if (error) diagnostics.push({ from: 0, to: yaml[0].length - 1, severity: 'error', message: error })
  } else if (/^---[ \t]*\n(?:[ \t]*#.*\n)*[ \t]*[\w-]+[ \t]*:/.test(text)) {
    diagnostics.push({ from: 0, to: 3, severity: 'warning', message: 'Close the YAML front matter with three dashes.' })
  }

  let fence: Opening | undefined
  let equation: Opening | undefined
  const directives: Opening[] = []
  let offset = yaml?.[0].length ?? 0
  let range = 0
  for (const line of text.slice(offset).split('\n')) {
    while (html[range] && html[range].end <= offset) range++
    if (html[range] && html[range].start < offset + line.length && html[range].end > offset) {
      offset += line.length + 1
      continue
    }
    const blank = /^ {0,3}([`]{3,}|~{3,})(.*)$/.exec(line)
    const math = /^ {0,3}(\${2,})[ \t]*$/.exec(line)
    if (fence) {
      if (blank && blank[1][0] === fence.token[0] && blank[1].length >= fence.token.length && !blank[2].trim()) fence = undefined
    } else if (equation) {
      if (math && math[1].length >= equation.token.length) equation = undefined
    } else if (blank && (blank[1][0] !== '`' || !blank[2].includes('`'))) {
      fence = { token: blank[1], from: offset }
    } else if (math) {
      equation = { token: math[1], from: offset }
    } else {
      const directive = /^ {0,3}(:{3,})([\w-][\w-]*.*)?[ \t]*$/.exec(line)
      if (directive?.[2]) directives.push({ token: directive[1], from: offset })
      else if (directive && directive[1].length >= (directives.at(-1)?.token.length ?? Infinity)) directives.pop()
    }
    offset += line.length + 1
  }

  const warn = (opening: Opening, message: string) => diagnostics.push({
    from: opening.from, to: opening.from + opening.token.length, severity: 'warning', message,
  })
  if (fence) warn(fence, 'Close the Markdown code fence.')
  if (equation) warn(equation, 'Close the block equation.')
  const directive = directives.at(-1)
  if (directive) warn(directive, 'Close the Markdown directive.')
  return diagnostics
}

export function validateSource(text: string) {
  const diagnostics = scanSource(text)
  if (!diagnostics.length || !text.includes('<')) return diagnostics
  const html: Range[] = []
  function collect(node: Nodes) {
    if (node.type === 'html' && node.value.includes('\n')) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) html.push({ start, end })
    } else if ('children' in node) node.children.forEach(collect)
  }
  collect(markdownProcessor.parse(text))
  return html.length ? scanSource(text, html) : diagnostics
}
