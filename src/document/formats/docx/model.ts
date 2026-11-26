import type { JSONContent } from '@tiptap/core'

export interface DocxIssue {
  code: string
  feature: string
  location?: string
  effect: 'preserved' | 'approximated' | 'omitted'
  message: string
}

export interface DocxCodec {
  read(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<{ document: JSONContent; issues: DocxIssue[] }>
  write(document: JSONContent, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>
}

export const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const docxMaxFileBytes = 24 * 1024 * 1024
export const docxMaxXmlPartBytes = 8 * 1024 * 1024
export const docxMaxXmlElements = 240_000
export const docxMaxWorkspaceSnapshot = 12 * 1024 * 1024
/** Table column widths are whole CSS pixels. Word stores twentieths of a point, so 1 px is exactly 15 twips at 96 DPI. */
export const docxColumnWidth = { min: 24, max: 2000, twips: 15 } as const

export function docxColumnWidthValue(value: unknown) {
  const width = Array.isArray(value) && value.length === 1 ? value[0] : undefined
  return Number.isInteger(width) && width >= docxColumnWidth.min && width <= docxColumnWidth.max ? width as number : undefined
}

export function readDocxSnapshot(source: string): JSONContent {
  if (source.length > docxMaxWorkspaceSnapshot) throw new Error('The DOCX draft exceeds Folio’s workspace editing limit.')
  const document = canonicalDocx(JSON.parse(source))
  if (JSON.stringify(document) !== source) throw new Error('Folio received an invalid DOCX draft.')
  return document
}

export function safeDocxLink(value: string) {
  // eslint-disable-next-line no-control-regex -- Do not accept ambiguous URL controls or ASCII whitespace.
  if (!value || value.length > 8192 || /[\s\u0000-\u0020\u007f-\u009f\\]/u.test(value)) return false
  if (/^(mailto|tel):[^?#]/i.test(value)) return !/%0[ad]/i.test(value)
  if (!/^https?:\/\/[^/]/i.test(value)) return false
  try {
    const url = new URL(value)
    return !!url.hostname && !url.username && !url.password
  } catch { return false }
}

const inline = ['text', 'hardBreak']
const children: Record<string, readonly string[]> = {
  doc: ['paragraph', 'heading', 'bulletList', 'orderedList', 'table'],
  paragraph: inline, heading: inline,
  bulletList: ['listItem'], orderedList: ['listItem'], listItem: ['paragraph'],
  table: ['tableRow'], tableRow: ['tableCell', 'tableHeader'], tableCell: ['paragraph'], tableHeader: ['paragraph'],
  text: [], hardBreak: [],
}
const optionalContent = new Set(['paragraph', 'heading', 'text', 'hardBreak'])
const markTypes = ['bold', 'italic', 'underline', 'link']
const defaults: Record<string, unknown> = { frontMatter: '', colspan: 1, rowspan: 1, textAlign: 'left' }

function invalid(reason: string): never {
  throw new Error(`This DOCX edit is outside Folio’s supported subset. ${reason}`)
}

function marksOf(node: JSONContent) {
  const seen = new Set<string>()
  const marks = (node.marks ?? []).map(mark => {
    const { type, attrs } = mark
    if (!markTypes.includes(type) || seen.has(type)) invalid(`Unsupported ${type} formatting.`)
    seen.add(type)
    if (type === 'link') {
      const href = attrs?.href
      if (typeof href !== 'string' || !safeDocxLink(href)) invalid('Enter a safe absolute link.')
      return { type, attrs: { href } }
    }
    return { type }
  })
  return marks.sort((left, right) => markTypes.indexOf(left.type) - markTypes.indexOf(right.type))
}

export function canonicalDocx(input: JSONContent): JSONContent {
  let nodes = 0
  let characters = 0
  function visit(node: JSONContent, types: readonly string[]): JSONContent {
    const type = node?.type
    if (!type || !types.includes(type)) invalid(`Unsupported ${type ?? 'document'} structure.`)
    if (++nodes > 100_000) invalid('There are too many document elements.')
    const attrs = node.attrs ?? {}
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'level' && type === 'heading' || key === 'start' && type === 'orderedList') continue
      if (key === 'colwidth' && (type === 'tableCell' || type === 'tableHeader')) {
        if (value !== null && value !== undefined && docxColumnWidthValue(value) === undefined) invalid('Use a column width from 24 to 2000 pixels.')
        continue
      }
      if (value !== null && value !== undefined && (!Object.hasOwn(defaults, key) || defaults[key] !== value)) {
        invalid(`Unsupported ${key} formatting.`)
      }
    }
    if (type === 'text') {
      const value = node.text
      if (node.content?.length) invalid('A text run cannot contain other elements.')
      // eslint-disable-next-line no-control-regex -- XML 1.0 excludes these characters and lone UTF-16 surrogates.
      if (!value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) invalid('The text contains characters that Word XML cannot store.')
      characters += value.length
      if (characters > docxMaxXmlPartBytes) invalid('The text exceeds the document limit.')
      const marks = marksOf(node)
      return { type, text: value, ...(marks.length ? { marks } : {}) }
    }
    if (node.text !== undefined) invalid(`A ${type} contains unexpected raw text.`)
    const marks = type === 'hardBreak' ? marksOf(node) : []
    if (type !== 'hardBreak' && node.marks?.length) invalid('Unsupported block formatting.')
    const content: JSONContent[] = []
    for (const child of node.content ?? []) {
      const next = visit(child, children[type])
      const previous = content.at(-1)
      if (next.type === 'text' && previous?.type === 'text' && JSON.stringify(previous.marks) === JSON.stringify(next.marks)) previous.text += next.text!
      else content.push(next)
    }
    if (!content.length && !optionalContent.has(type)) invalid(`A ${type} is missing content.`)
    if (type === 'listItem' && content.length !== 1) invalid('A list item supports one paragraph.')
    if (type === 'table') {
      const columns = content[0].content?.length ?? 0
      for (const [index, row] of content.entries()) {
        const cells = row.content ?? []
        if (cells.length !== columns || cells.some(cell => cell.type !== cells[0].type) || index > 0 && cells[0].type === 'tableHeader') {
          invalid('Tables must be rectangular with at most one header row at the top.')
        }
      }
      // A column has one width. The first width set in the column applies to every cell, including rows added later.
      for (let column = 0; column < columns; column++) {
        const width = (node.content ?? []).map(row => docxColumnWidthValue(row.content?.[column]?.attrs?.colwidth)).find(value => value !== undefined)
        if (width === undefined) continue
        for (const row of content) {
          const { type: cellType, content: cellContent } = row.content![column]
          row.content![column] = { type: cellType, attrs: { colwidth: [width] }, ...(cellContent ? { content: cellContent } : {}) }
        }
      }
    }
    const result: JSONContent = { type, ...(content.length ? { content } : {}), ...(marks.length ? { marks } : {}) }
    if (type === 'heading') {
      if (!Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6) invalid('Use heading levels 1 through 6.')
      return { type, attrs: { level: attrs.level }, ...(content.length ? { content } : {}) }
    }
    if (type === 'orderedList') {
      const start: number = attrs.start ?? 1
      if (!Number.isInteger(start) || start < 1 || start > 1_000_000) invalid('Unsupported list start number.')
      return { type, attrs: { start }, content }
    }
    return result
  }
  return visit(input, ['doc'])
}

export function docxText(document: JSONContent): string {
  if (document.type === 'text') return document.text ?? ''
  if (document.type === 'hardBreak') return '\n'
  const separator = document.type === 'paragraph' || document.type === 'heading' ? '' : '\n'
  return (document.content ?? []).map(docxText).join(separator)
}
