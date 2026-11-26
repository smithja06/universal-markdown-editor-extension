import { cellAddress, parseAddress, rangeSize, spreadsheetLimits, type Cell, type CellStyle, type CellValue, type ConditionalRule, type Point, type Range, type Sheet } from '../../document/formats/spreadsheet/model'

export const defaultWidth = 104
export const defaultHeight = 26
export const rowHeaderWidth = 48
export const columnHeaderHeight = 26

export function contains(range: Range, row: number, col: number) {
  return row >= range.row && row <= range.endRow && col >= range.col && col <= range.endCol
}

export function intersects(a: Range, b: Range) {
  return a.row <= b.endRow && a.endRow >= b.row && a.col <= b.endCol && a.endCol >= b.col
}

export function axisMetrics(limit: number, base: number, sizes: Record<number, number>, hidden: number[] = []) {
  const changes = new Map(Object.entries(sizes).map(([key, value]) => [Number(key), Number.isFinite(value) ? Math.max(1, Math.min(1000, value)) : base]))
  hidden.forEach(index => changes.set(index, 0))
  let delta = 0
  const marks = [...changes].filter(([index]) => index >= 1 && index <= limit).sort(([a], [b]) => a - b).map(([index, value]) => {
    delta += value - base
    return { index, delta }
  })
  function offset(index: number) {
    let left = 0
    let right = marks.length
    while (left < right) {
      const mid = (left + right) >>> 1
      if (marks[mid].index < index) left = mid + 1
      else right = mid
    }
    return (index - 1) * base + (marks[left - 1]?.delta ?? 0)
  }
  function index(pixels: number) {
    let left = 1
    let right = limit
    while (left < right) {
      const mid = (left + right) >>> 1
      if (offset(mid + 1) <= pixels) left = mid + 1
      else right = mid
    }
    return left
  }
  function visible(start: number, end: number) {
    const results: number[] = []
    for (let item = index(Math.max(0, start)); item <= limit && offset(item) < end;) {
      const next = offset(item + 1)
      if (next > offset(item)) results.push(item++)
      else if (next < offset(limit + 1)) item = index(next)
      else break
    }
    return results
  }
  return { offset, index, visible, size: (item: number) => offset(item + 1) - offset(item), total: offset(limit + 1) }
}

export type AxisMetrics = ReturnType<typeof axisMetrics>

export const formats = [
  ['General', 'General'], ['Number', '#,##0.00'], ['Percentage', '0.00%'],
  ['Euro (€)', '"€"#,##0.00'], ['US Dollar ($)', '"$"#,##0.00'], ['British Pound (£)', '"£"#,##0.00'],
  ['Canadian Dollar (CAD)', '"CAD "#,##0.00'], ['Short Date', 'm/d/yy'], ['Long Date', 'dddd, mmmm d, yyyy'],
] as const

export function decimalFormat(format: string | undefined, delta: number) {
  const current = !format || format === 'General' ? '0' : format
  if (!supportedNumberFormat(current)) return current
  const decimal = /([#0]+)(?:\.([#0]+))?(?=[^#0]*$)/.exec(current)
  if (!decimal) return current
  const places = Math.max(0, Math.min(12, (decimal[2]?.length ?? 0) + delta))
  return current.slice(0, decimal.index) + decimal[1] + (places ? '.' + '0'.repeat(places) : '') + current.slice(decimal.index + decimal[0].length)
}

export function supportedNumberFormat(format: string) {
  return format === 'General' || /^(?:"[^"]{1,12}")?(?:#,##)?0(?:\.[0#]{1,12})?%?$/.test(format) ||
    /^(?:yyyy-mm-dd|m\/d\/yy|dddd, mmmm d, yyyy|h:mm|h:mm:ss)$/.test(format)
}

const numberFormats = new Map<string, Intl.NumberFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

function formatNumber(value: number, locale: string, options: Intl.NumberFormatOptions = {}) {
  const key = locale + JSON.stringify(options)
  let formatter = numberFormats.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options)
    if (numberFormats.size > 100) numberFormats.clear()
    numberFormats.set(key, formatter)
  }
  return formatter.format(value)
}

function formatDate(value: Date, locale: string, options: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(options)
  let formatter = dateFormats.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
    if (dateFormats.size > 100) dateFormats.clear()
    dateFormats.set(key, formatter)
  }
  return formatter.format(value)
}

export function displayCell(cell: Cell | undefined, locale: string, date1904: boolean, calculated?: CellValue): string {
  if (!cell) return ''
  const value = cell.kind === 'formula' ? calculated ?? cell.cached : cell.value
  if (value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value !== 'number') return value
  const specifiedFormat = cell.style?.numberFormat
  const format = specifiedFormat ?? 'General'
  const pattern = format.replace(/"[^"]*"|\\./g, '').toLowerCase()
  if (!specifiedFormat && cell.kind === 'date' || /[dyhs]/.test(pattern) && !/[0#]/.test(pattern)) {
    if (!date1904 && Math.floor(value) === 60 && !pattern.includes(':')) return '1900-02-29'
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, value < 60 ? 31 : 30)
    const date = new Date(epoch + value * 86_400_000)
    if (!Number.isFinite(date.getTime())) return String(value)
    if (pattern === 'yyyy-mm-dd') return date.toISOString().split('T')[0]
    if (pattern.includes(':') && !/[dy]/.test(pattern)) {
      return formatDate(date, locale, { hour: 'numeric', minute: '2-digit', ...(pattern.includes('s') ? { second: '2-digit' } : {}) })
    }
    return formatDate(date, locale, pattern.includes('mmmm') ? { dateStyle: 'full' } : { dateStyle: 'short' })
  }
  const numeric = /^(?:"([^"]*)")?(#,##)?0(?:\.([0#]{1,12}))?(%)?$/.exec(format)
  if (numeric) {
    const [, prefix = '', grouping, decimal = '', percentage] = numeric
    return prefix + formatNumber(value, locale, { style: percentage ? 'percent' : 'decimal', useGrouping: !!grouping,
      minimumFractionDigits: (decimal.match(/0/g) ?? []).length, maximumFractionDigits: decimal.length })
  }
  return formatNumber(value, locale, { useGrouping: false, maximumSignificantDigits: 15 })
}

export function wrapHeights(sheet: Sheet, locale: string, date1904: boolean) {
  const heights = { ...sheet.heights }
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (!cell.style?.wrap) continue
    const point = parseAddress(address)
    if (!point || sheet.heights[point.row] !== undefined) continue
    const width = sheet.widths[point.col] ?? defaultWidth
    const size = (cell.style.size ?? 11) * 4 / 3
    const chars = Math.max(1, Math.floor((width - 10) / (size * .54)))
    const lines = displayCell(cell, locale, date1904).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / chars)), 0)
    heights[point.row] = Math.min(360, Math.max(heights[point.row] ?? defaultHeight, Math.ceil(lines * size * 1.3 + 6)))
  }
  return heights
}

export function fontFamily(font?: string) {
  return font ? '"' + [...font].filter(char => char !== '"' && char !== '\\' &&char.charCodeAt(0) >= 32).join('') + '", Arial, sans-serif' : undefined
}

export type MeasureText = (text: string, font: string) => number

let measureContext: CanvasRenderingContext2D | null | undefined
export const measureText: MeasureText = (text, font) => {
  measureContext ??= document.createElement('canvas').getContext('2d')
  if (!measureContext) return text.length * 8
  measureContext.font = font
  return measureContext.measureText(text).width
}

function cellFont(style: CellStyle | undefined, header: boolean) {
  const size = (style?.size ?? 11) * 4 / 3
  const weight = style?.bold ? 700 : header ? 650 : 400
  return { size, font: (style?.italic ? 'italic ' : '') + weight + ' ' + size + 'px ' + (fontFamily(style?.font) ?? 'Arial, sans-serif') }
}

function wrappedLines(text: string, font: string, width: number, measure: MeasureText) {
  let lines = 1
  let current = ''
  for (const word of text.split(/(?<=\s)/)) {
    if (measure((current + word).trimEnd(), font) <= width) { current += word; continue }
    if (current) { lines++; current = '' }
    for (const char of word) {
      if (current && measure((current + char).trimEnd(), font) > width) { lines++; current = '' }
      current += char
    }
  }
  return lines
}

// Horizontal cell padding (5px per side) plus the 1px grid border, and vertical padding (2px per side) plus border.
const fitPaddingX = 11
const fitPaddingY = 5

export interface FitOptions { locale: string; date1904: boolean; calculated?: Record<string, CellValue>; header?: boolean; measure?: MeasureText }

/** Sizes that fit the content of each index; `undefined` marks an index with no content, which returns to the default size. */
export function fitSizes(sheet: Sheet, axis: 'row' | 'col', indices: number[], { locale, date1904, calculated, header = false, measure = measureText }: FitOptions) {
  const wanted = new Set(indices)
  const sizes = new Map<number, number | undefined>(indices.map(index => [index, undefined]))
  const spans = sheet.merges.filter(merge => axis === 'col' ? merge.col !== merge.endCol : merge.row !== merge.endRow)
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const point = parseAddress(address)
    if (!point || !wanted.has(point[axis]) || spans.some(merge => contains(merge, point.row, point.col))) continue
    const text = displayCell(cell, locale, date1904, calculated?.[address])
    if (!text) continue
    const { size, font } = cellFont(cell.style, header && point.row === 1)
    let fit: number
    if (axis === 'col') {
      fit = Math.ceil(Math.max(...text.split('\n').map(line => measure(line, font)))) + fitPaddingX + 2
    } else {
      const available = (sheet.widths[point.col] ?? defaultWidth) - fitPaddingX
      const lines = text.split('\n').reduce((sum, line) => sum + (cell.style?.wrap && line ? wrappedLines(line, font, available, measure) : 1), 0)
      fit = Math.max(defaultHeight, Math.ceil(lines * size * 1.3 + fitPaddingY))
    }
    sizes.set(point[axis], Math.min(1000, Math.max(fit, axis === 'col' ? 24 : 16, sizes.get(point[axis]) ?? 0)))
  }
  return sizes
}

export interface ConditionalAppearance { color?: string; bar?: number }

function actualValue(cell: Cell | undefined, calculated?: CellValue) {
  return cell?.kind === 'formula' ? calculated ?? cell.cached : cell?.value
}

function mixColors(first: string, last: string, ratio: number) {
  if (!/^#[a-f0-9]{6}$/i.test(first) || !/^#[a-f0-9]{6}$/i.test(last)) return first
  const channel = (offset: number) => Math.round(parseInt(first.slice(offset, offset + 2), 16) * (1 - ratio) + parseInt(last.slice(offset, offset + 2), 16) * ratio)
  return 'rgb(' + [channel(1), channel(3), channel(5)].join(', ') + ')'
}

export function ruleAppearance(sheet: Sheet, calculated: Record<string, CellValue> = {}) {
  const entries = sheet.rules.filter(rule => rangeSize(rule.range) <= spreadsheetLimits.rangeCells).map(rule => {
    let min = Infinity
    let max = -Infinity
    const counts = new Map<CellValue, number>()
    if (rule.operator === 'duplicate' || rule.operator === 'colorScale' || rule.operator === 'dataBar') {
      for (let row = rule.range.row; row <= rule.range.endRow; row++) for (let col = rule.range.col; col <= rule.range.endCol; col++) {
        const address = cellAddress(row, col)
        const value = actualValue(sheet.cells[address], calculated[address])
        if (typeof value === 'number') { min = Math.min(min, value); max = Math.max(max, value) }
        if (rule.operator === 'duplicate' && value !== undefined && value !== '') counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }
    return { rule, min, max, counts }
  })
  return (point: Point, cell: Cell | undefined, result?: CellValue): ConditionalAppearance => {
    const value = actualValue(cell, result)
    if (value === undefined) return {}
    for (const { rule, min, max, counts } of entries) {
      if (!contains(rule.range, point.row, point.col)) continue
      const operand = Number(rule.value)
      switch (rule.operator) {
        case 'greater': if (typeof value === 'number' && value > operand) return { color: rule.color }; break
        case 'less': if (typeof value === 'number' && value < operand) return { color: rule.color }; break
        case 'equal': {
          const matched = typeof value === 'number'
            ? rule.valueType !== 'text' && value === operand
            : rule.valueType !== 'number' && (typeof value === 'string' || rule.valueType === undefined) &&
              String(value).toLowerCase() === rule.value?.toLowerCase()
          if (matched) return { color: rule.color }
          break
        }
        case 'between': if (typeof value === 'number' && value >= operand && value <= Number(rule.upper)) return { color: rule.color }; break
        case 'contains': if (rule.value && String(value).toLowerCase().includes(rule.value.toLowerCase())) return { color: rule.color }; break
        case 'duplicate': if ((counts.get(value) ?? 0) > 1) return { color: rule.color }; break
        case 'colorScale': if (typeof value === 'number') return { color: mixColors(rule.color, rule.color2 ?? '#ffffff', max === min ? 0 : (value - min) / (max - min)) }; break
        case 'dataBar': if (typeof value === 'number') return { color: rule.color, bar: max === min ? 1 : (value - min) / (max - min) }; break
      }
    }
    return {}
  }
}

export function shiftSheet(sheet: Sheet, axis: 'row' | 'col', at: number, insert: boolean): Sheet {
  const limit = axis === 'row' ? spreadsheetLimits.rows : spreadsheetLimits.cols
  const shift = (value: number) => value < at ? value : value === at && !insert ? undefined : value + (insert ? 1 : -1)
  const cells: Sheet['cells'] = {}
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const point = parseAddress(address)
    if (!point) continue
    const next = shift(point[axis])
    if (next && next <= limit) {
      point[axis] = next
      cells[cellAddress(point.row, point.col)] = cell
    }
  }
  const shiftDimensions = (dimensions: Record<number, number>) => Object.fromEntries(Object.entries(dimensions).flatMap(([index, size]) => {
    const next = shift(Number(index))
    return next && next <= limit ? [[next, size]] : []
  }))
  const shiftHidden = (hidden: number[] | undefined) => hidden?.map(shift).filter((value): value is number => !!value && value <= limit)
  function shiftRange(range: Range): Range | undefined {
    const end = axis === 'row' ? 'endRow' : 'endCol'
    const startValue = shift(range[axis]) ?? at
    const endValue = Math.min(limit, shift(range[end]) ?? at - 1)
    if (endValue >= startValue) return { ...range, [axis]: startValue, [end]: endValue }
  }
  function shiftRule(rule: ConditionalRule): ConditionalRule[] {
    const range = shiftRange(rule.range)
    return range ? [{ ...rule, range }] : []
  }
  const next = axis === 'row' ? { heights: shiftDimensions(sheet.heights), hiddenRows: shiftHidden(sheet.hiddenRows),
    rowCount: Math.max(0, Math.min(limit, (sheet.rowCount ?? 0) + (at <= (sheet.rowCount ?? 0) + Number(insert) ? (insert ? 1 : -1) : 0))),
    frozenRows: at <= sheet.frozenRows ? Math.max(0, sheet.frozenRows + (insert ? 1 : -1)) : sheet.frozenRows,
  } : { widths: shiftDimensions(sheet.widths), hiddenCols: shiftHidden(sheet.hiddenCols),
    colCount: Math.max(0, Math.min(limit, (sheet.colCount ?? 0) + (at <= (sheet.colCount ?? 0) + Number(insert) ? (insert ? 1 : -1) : 0))),
    frozenCols: at <= sheet.frozenCols ? Math.max(0, sheet.frozenCols + (insert ? 1 : -1)) : sheet.frozenCols,
  }
  return { ...sheet, ...next, cells, rules: sheet.rules.flatMap(shiftRule), merges: sheet.merges.flatMap(merge => {
    const shifted = shiftRange(merge)
    return shifted && rangeSize(shifted) > 1 ? [shifted] : []
  }) }
}

export function shiftCsvRows(rowWidths: number[], axis: 'row' | 'col', at: number, insert: boolean) {
  if (axis === 'col') return rowWidths.map(width => Math.max(1, width + (insert
    ? Number(at <= width + 1) : -Number(at <= width))))
  if (!insert && at > rowWidths.length || insert && at > rowWidths.length + 1) return rowWidths
  const widths = rowWidths.slice()
  widths.splice(at - 1, insert ? 0 : 1, ...(insert ? [1] : []))
  return widths
}

export function rewriteSheetReferences(formula: string, original: string, replacement?: string) {
  const token = /"(?:[^"]|"")*"|'(?:[^']|'')+'!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|(?<![\w.:\]\p{L}])[\p{L}_][\p{L}\p{N}_.]*!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/giu
  return formula.replace(token, reference => {
    if (reference.startsWith('"')) return reference
    const separator = reference.lastIndexOf('!')
    const name = reference.slice(0, separator).replace(/^'|'$/g, '').replace(/''/g, "'")
    if (name.toLowerCase() !== original.toLowerCase()) return reference
    return replacement ? "'" + replacement.replace(/'/g, "''") + "'" + reference.slice(separator) : '#REF!'
  })
}
