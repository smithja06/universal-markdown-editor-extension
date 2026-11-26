import { needsGlyph } from './coverage'
import { marginSizes, pageDimensions, type Inline, type PdfPageOptions, type PrintBlock, type PrintDocument, type TableCell } from './model'

export interface Coverage { body: Set<number>; mono: Set<number> }
type Content = Record<string, unknown> | string | Content[]

export const bodyFont = 'FolioSans'
export const monoFont = 'FolioMono'
export const fontFiles = {
  [bodyFont]: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' },
  // One monospaced face is bundled. Bold or italic code keeps its weight and slant as plain text.
  [monoFont]: { normal: 'DejaVuSansMono.ttf', bold: 'DejaVuSansMono.ttf', italics: 'DejaVuSansMono.ttf', bolditalics: 'DejaVuSansMono.ttf' },
}

/** DejaVu Sans Mono advance width (1233 of 2048 units per em). */
export const monoAdvance = 1233 / 2048
const bodySize = 10.5
const codeSize = 8.5
export const literalSize = 9.5
const headingSizes = [20, 16, 13.5, 12, 11, 10.5]
const ink = '#1f2622'
const muted = '#5d6a62'
const rule = '#c9d1c9'

export function contentWidth(options: PdfPageOptions) {
  return pageDimensions(options).width - 2 * marginSizes[options.margins].points
}

export function literalColumns(options: PdfPageOptions, size = literalSize, inset = 0) {
  return Math.max(10, Math.floor((contentWidth(options) - inset) / (size * monoAdvance)))
}

/** Expands tabs and hard-wraps each line at a fixed column, counting code points. */
export function wrapLiteral(text: string, columns: number) {
  const lines: string[] = []
  let wrapped = 0
  for (const line of text.split('\n')) {
    let expanded = ''
    let column = 0
    for (const character of line) {
      if (character === '\t') { const spaces = 8 - (column % 8); expanded += ' '.repeat(spaces); column += spaces }
      else { expanded += character; column++ }
    }
    const points = Array.from(expanded)
    if (points.length <= columns) { lines.push(expanded); continue }
    wrapped++
    for (let start = 0; start < points.length; start += columns) lines.push(points.slice(start, start + columns).join(''))
  }
  return { lines, wrapped }
}

/** Splits text into runs whose glyphs exist in the body font, falling back to the bundled mono font. */
function segments(text: string, coverage: Coverage, mono: boolean) {
  const runs: { text: string; font?: string }[] = []
  for (const character of text) {
    const point = character.codePointAt(0)!
    const primary = mono ? coverage.mono : coverage.body
    const font = !needsGlyph(point) || primary.has(point) || !coverage.mono.has(point) ? undefined : monoFont
    const last = runs.at(-1)
    if (last && last.font === font) last.text += character
    else runs.push({ text: character, font })
  }
  return runs
}

export function missingGlyphs(print: PrintDocument, coverage: Coverage) {
  const missing = new Map<string, number>()
  const visit = (text: string, mono: boolean) => {
    for (const character of text) {
      const point = character.codePointAt(0)!
      if (needsGlyph(point) && !coverage.mono.has(point) && (mono || !coverage.body.has(point))) missing.set(character, (missing.get(character) ?? 0) + 1)
    }
  }
  const inlines = (items: Inline[]) => { for (const item of items) if ('text' in item) visit(item.text, !!item.code) }
  const blocks = (items: PrintBlock[]) => {
    for (const block of items) {
      if (block.kind === 'heading' || block.kind === 'paragraph') inlines(block.inlines)
      else if (block.kind === 'list') block.items.forEach(item => blocks(item.blocks))
      else if (block.kind === 'quote') { visit(block.label ?? '', false); blocks(block.blocks) }
      else if (block.kind === 'code' || block.kind === 'literal') visit(block.text, true)
      else if (block.kind === 'table') block.rows.forEach(row => row.forEach(cell => inlines(cell.inlines)))
      else if (block.kind === 'image') visit(block.caption ?? '', false)
    }
  }
  blocks(print.blocks)
  return missing
}

function inlineContent(inlines: Inline[], coverage: Coverage): Content[] {
  const result: Content[] = []
  for (const inline of inlines) {
    if ('break' in inline) { result.push('\n'); continue }
    const decoration = [inline.underline || inline.link ? 'underline' : undefined, inline.strike ? 'lineThrough' : undefined].filter(Boolean)
    for (const run of segments(inline.text, coverage, !!inline.code)) {
      result.push({
        text: run.text, bold: inline.bold || undefined, italics: inline.italic || undefined,
        font: run.font ?? (inline.code ? monoFont : undefined), fontSize: inline.code ? bodySize * 0.92 : undefined,
        background: inline.code ? '#eef1ed' : undefined, decoration: decoration.length ? decoration : undefined,
        link: inline.link, color: inline.link ? '#1d5fa8' : undefined,
      })
    }
  }
  return result.length ? result : ['']
}

function literalContent(text: string, columns: number, size: number, coverage: Coverage) {
  const { lines } = wrapLiteral(text, columns)
  const chunks: Content[] = []
  // Separate nodes keep long literal text cheap to measure and paginate.
  for (let index = 0; index < lines.length; index += 200) {
    const chunk = lines.slice(index, index + 200).join('\n')
    chunks.push({ text: segments(chunk, coverage, true).map(run => ({ text: run.text, font: run.font })), font: monoFont, fontSize: size,
      lineHeight: 1.18, preserveLeadingSpaces: true, preserveTrailingSpaces: true })
  }
  return chunks
}

function tableBody(rows: TableCell[][], header: boolean, coverage: Coverage) {
  const columns = Math.max(1, ...rows.map(row => row.reduce((total, cell) => total + (cell.colSpan ?? 1), 0)))
  const occupied = new Map<string, true>()
  const body: Content[][] = []
  rows.forEach((row, rowIndex) => {
    const output: Content[] = []
    let column = 0
    for (const cell of row) {
      while (occupied.has(rowIndex + ':' + column)) { output.push({}); column++ }
      const colSpan = Math.min(cell.colSpan ?? 1, columns - column)
      const rowSpan = Math.min(cell.rowSpan ?? 1, rows.length - rowIndex)
      for (let r = 0; r < rowSpan; r++) for (let c = 0; c < colSpan; c++) if (r || c) occupied.set((rowIndex + r) + ':' + (column + c), true)
      output.push({ text: inlineContent(cell.inlines, coverage), colSpan: colSpan > 1 ? colSpan : undefined, rowSpan: rowSpan > 1 ? rowSpan : undefined,
        alignment: cell.align, bold: header && rowIndex === 0 ? true : undefined, fillColor: header && rowIndex === 0 ? '#eef1ed' : undefined })
      for (let c = 1; c < colSpan; c++) output.push({})
      column += colSpan
    }
    while (column < columns) { output.push(occupied.has(rowIndex + ':' + column) ? {} : ''); column++ }
    body.push(output)
  })
  return { body, columns }
}

function blockContent(block: PrintBlock, options: PdfPageOptions, coverage: Coverage, inset: number): Content {
  const width = contentWidth(options) - inset
  switch (block.kind) {
    case 'heading': {
      const size = headingSizes[block.level - 1] ?? bodySize
      return { text: inlineContent(block.inlines, coverage), fontSize: size, bold: true, margin: [0, block.level <= 2 ? 12 : 8, 0, 5], headlineLevel: block.level }
    }
    case 'paragraph': return { text: inlineContent(block.inlines, coverage), alignment: block.align, margin: [0, 0, 0, 7] }
    case 'rule': return { canvas: [{ type: 'line', x1: 0, y1: 4, x2: width, y2: 4, lineWidth: 0.6, lineColor: rule }], margin: [0, 4, 0, 10] }
    case 'code': return {
      table: { widths: ['*'], body: [[{ stack: literalContent(block.text, literalColumns(options, codeSize, inset + 12), codeSize, coverage), fillColor: '#f3f5f2' }]] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5 },
      margin: [0, 2, 0, 9],
    }
    case 'literal': return { stack: literalContent(block.text, literalColumns(options, literalSize, inset), literalSize, coverage) }
    case 'quote': return {
      table: { widths: ['*'], body: [[{ stack: [
        ...(block.label ? [{ text: block.label, bold: true, color: muted, margin: [0, 0, 0, 3] }] : []),
        ...block.blocks.map(child => blockContent(child, options, coverage, inset + 14)),
      ] }]] },
      layout: { hLineWidth: () => 0, vLineWidth: (index: number) => index === 0 ? 2.5 : 0, vLineColor: () => '#9fb3a5',
        paddingLeft: () => 10, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 0 },
      color: '#33403a', margin: [0, 2, 0, 8],
    }
    case 'list': {
      const items = block.items.map(item => {
        const stack = item.blocks.map(child => blockContent(child, options, coverage, inset + 18))
        if (item.checked === undefined || item.checked === null) return { stack }
        const marker = { text: segments(item.checked ? '☑ ' : '☐ ', coverage, false).map(run => ({ text: run.text, font: run.font })) }
        return { columns: [{ width: 14, ...marker }, { width: '*', stack }], columnGap: 2 }
      })
      const tasks = block.items.some(item => item.checked !== undefined && item.checked !== null)
      return block.ordered ? { ol: items, start: block.start ?? 1, margin: [0, 0, 0, 5] } : { ul: items, type: tasks ? 'none' : undefined, margin: [0, 0, 0, 5] }
    }
    case 'table': {
      const { body, columns } = tableBody(block.rows, block.header, coverage)
      return {
        table: { headerRows: block.header ? 1 : 0, widths: Array(columns).fill('*'), body },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => rule, vLineColor: () => rule,
          paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 },
        fontSize: bodySize * 0.92, margin: [0, 2, 0, 9],
      }
    }
    case 'image': {
      const { height } = pageDimensions(options)
      const maxHeight = (height - 2 * marginSizes[options.margins].points) * 0.85
      const scale = Math.min(1, width / block.width, maxHeight / block.height)
      return { stack: [
        { image: block.src, width: block.width * scale, height: block.height * scale, alignment: block.align ?? 'center' },
        ...(block.caption ? [{ text: block.caption, italics: true, fontSize: bodySize * 0.88, color: muted, alignment: 'center', margin: [0, 3, 0, 0] }] : []),
      ], margin: [0, 3, 0, 9] }
    }
  }
}

/** Converts the print model to a pdfmake document definition. */
export function layoutPdf(print: PrintDocument, options: PdfPageOptions, coverage: Coverage) {
  const margin = marginSizes[options.margins].points
  const { width, height } = pageDimensions(options)
  return {
    info: { title: print.title, creator: 'Folio', producer: 'Folio' },
    pageSize: { width, height },
    pageMargins: [margin, margin, margin, margin],
    defaultStyle: { font: bodyFont, fontSize: bodySize, lineHeight: 1.3, color: ink },
    footer: (page: number, pages: number) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 8, color: muted, margin: [0, Math.max(8, margin / 2 - 6), 0, 0] }),
    content: print.blocks.map(block => blockContent(block, options, coverage, 0)),
  }
}
