import type { WorkbookTheme } from './themes'

export type SpreadsheetFormat = 'xlsx' | 'csv'
export type CellValue = string | number | boolean
export type CellKind = 'text' | 'number' | 'boolean' | 'formula' | 'error' | 'date'
export interface Border {
  color: string
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'
}
export interface CellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  font?: string
  size?: number
  color?: string
  fill?: string
  horizontal?: 'left' | 'center' | 'right'
  vertical?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  numberFormat?: string
  borders?: Partial<Record<'top' | 'right' | 'bottom' | 'left', Border>>
}
export interface Cell {
  kind: CellKind
  value: CellValue
  cached?: CellValue
  cachedError?: true
  style?: CellStyle
  link?: string
}
export interface Point { row: number; col: number }
export interface Range extends Point { endRow: number; endCol: number }
export interface ConditionalRule {
  id: string
  range: Range
  operator: 'greater' | 'less' | 'equal' | 'between' | 'contains' | 'duplicate' | 'colorScale' | 'dataBar'
  value?: string
  valueType?: 'text' | 'number'
  upper?: string
  color: string
  color2?: string
}
export interface Sheet {
  id: string
  name: string
  cells: Record<string, Cell>
  widths: Record<number, number>
  heights: Record<number, number>
  merges: Range[]
  rules: ConditionalRule[]
  gridLines: boolean
  frozenRows: number
  frozenCols: number
  hiddenRows?: number[]
  hiddenCols?: number[]
  rowCount?: number
  colCount?: number
}
export interface CsvDialect {
  delimiter: ',' | ';' | '\t' | '|'
  lineEnding: '\r\n' | '\n' | '\r'
  bom: boolean
  finalNewline: boolean
  header: boolean
  rowWidths: number[]
  ambiguous?: boolean
  mixedLineEndings?: boolean
}
export interface Workbook {
  sheets: Sheet[]
  locale: string
  timezone: string
  date1904: boolean
  imported: boolean
  warnings: string[]
  coreProperties?: Partial<Record<XlsxCoreProperty, string>>
  csv?: CsvDialect
  /** The XLSX workbook color theme. Cell colors are stored as resolved RGB, so changing the theme does not recolor cells. */
  theme?: WorkbookTheme
}

export type XlsxCoreProperty = 'title' | 'subject' | 'creator' | 'description' | 'identifier' | 'language'
  | 'keywords' | 'lastModifiedBy' | 'revision' | 'category' | 'contentStatus' | 'version' | 'created' | 'modified'

export const spreadsheetLimits = {
  fileBytes: 16 * 1024 * 1024,
  rows: 1_048_576,
  cols: 16_384,
  cells: 150_000,
  sheets: 64,
  rangeCells: 20_000,
  cellLength: 32_767,
} as const

export function createSheet(name: string): Sheet {
  return { id: crypto.randomUUID(), name, cells: {}, widths: {}, heights: {}, merges: [], rules: [], gridLines: true, frozenRows: 0, frozenCols: 0 }
}

export function createWorkbook(format: SpreadsheetFormat): Workbook {
  return {
    sheets: [createSheet('Sheet1')], locale: 'en-US', timezone: 'UTC', date1904: false, imported: false, warnings: [],
    ...(format === 'csv' ? { csv: { delimiter: ',', lineEnding: '\r\n', bom: false, finalNewline: false, header: false, rowWidths: [] } } : {}),
  }
}

export function columnName(col: number): string {
  let name = ''
  for (let index = col; index > 0; index = Math.floor((index - 1) / 26)) {
    name = String.fromCharCode(65 + (index - 1) % 26) + name
  }
  return name
}

export function cellAddress(row: number, col: number) {
  return columnName(col) + row
}

export function parseAddress(input: string): Point | undefined {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(input)
  if (!match) return
  const col = [...match[1].toUpperCase()].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0)
  const row = Number(match[2])
  if (row <= spreadsheetLimits.rows && col <= spreadsheetLimits.cols) return { row, col }
}

export function normalizeRange(anchor: Point, end: Point): Range {
  return { row: Math.min(anchor.row, end.row), col: Math.min(anchor.col, end.col), endRow: Math.max(anchor.row, end.row), endCol: Math.max(anchor.col, end.col) }
}

export function parseRange(input: string): Range | undefined {
  const [first, last = first, extra] = input.trim().split(':')
  const anchor = parseAddress(first)
  const end = parseAddress(last)
  if (anchor && end && extra === undefined) return normalizeRange(anchor, end)
}

export function rangeAddress(range: Range) {
  const first = cellAddress(range.row, range.col)
  return range.row === range.endRow && range.col === range.endCol ? first : first + ':' + cellAddress(range.endRow, range.endCol)
}

export function rangeSize(range: Range) {
  return (range.endRow - range.row + 1) * (range.endCol - range.col + 1)
}

export function safeSpreadsheetLink(input: string) {
  // eslint-disable-next-line no-control-regex -- Destinations must not contain literal whitespace or control characters.
  if (input.length > 2048 || !/^(https?:\/\/|mailto:)/i.test(input) || /[\u0000-\u0020\u007f]/.test(input)) return undefined
  try { return new URL(input).href } catch { return undefined }
}

export function enterCell(input: string, format: SpreadsheetFormat): Cell | undefined {
  if (!input) return
  if (input.length > spreadsheetLimits.cellLength || /[\uD800-\uDFFF]/u.test(input)) throw new Error('Cell text exceeds spreadsheet limits or contains invalid Unicode.')
  if (format === 'csv') return { kind: 'text', value: input }
  if (input.startsWith('=') && input.length > 1) return { kind: 'formula', value: input }
  if (input.startsWith("'")) return { kind: 'text', value: input.slice(1) }
  if (/^(true|false)$/i.test(input)) return { kind: 'boolean', value: input.toLowerCase() === 'true' }
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(input) &&
    input.replace(/^[+-]/, '').split(/[eE]/)[0].replace('.', '').length <= 15 && Number.isFinite(Number(input))) {
    return { kind: 'number', value: Number(input) }
  }
  return { kind: 'text', value: input }
}

export function cellInput(cell: Cell | undefined) {
  if (!cell) return ''
  return cell.kind === 'boolean' ? (cell.value ? 'TRUE' : 'FALSE') : String(cell.value)
}

export function editorText(raw: string) {
  return raw.replace(/\r\n?/g, '\n')
}

/** Textareas expose LF only. Retain the source endings outside the edited span. */
export function applyEditorText(previous: string, value: string) {
  if (!previous.includes('\r')) return value
  const normalized = editorText(previous)
  if (normalized === value) return previous
  let start = 0
  while (start < normalized.length && start < value.length && normalized[start] === value[start]) start++
  let end = normalized.length
  let newEnd = value.length
  while (end > start && newEnd > start && normalized[end - 1] === value[newEnd - 1]) { end--; newEnd-- }
  const breaks = previous.match(/\r\n|\r|\n/g) ?? []
  const count = (text: string) => (text.match(/\n/g) ?? []).length
  const restore = (text: string, index: number, limit = breaks.length) =>
    text.replace(/\n/g, () => index < limit ? breaks[index++] : breaks[0] ?? '\n')
  const prefix = normalized.slice(0, start)
  const prefixBreaks = count(prefix)
  const endBreak = prefixBreaks + count(normalized.slice(start, end))
  return restore(prefix, 0) + restore(value.slice(start, newEnd), prefixBreaks, endBreak) + restore(normalized.slice(end), endBreak)
}
