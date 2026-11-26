import { cellAddress, cellInput, createWorkbook, parseAddress, spreadsheetLimits, type CsvDialect, type Workbook } from './model'

const delimiters: CsvDialect['delimiter'][] = [',', ';', '\t', '|']
// eslint-disable-next-line no-control-regex -- Preserve CSV tabs and newlines while rejecting other binary controls.
const binaryControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/
class CsvQuotingError extends Error {}

function readRecords(text: string, delimiter: CsvDialect['delimiter'],
  receive: (fields: string[], ending?: CsvDialect['lineEnding']) => boolean | void) {
  let row: string[] = []
  let start = 0
  let quoted = false
  let closed = false
  let value = ''
  function field(end: number) {
    const fieldValue = closed ? value : text.slice(start, end)
    if (fieldValue.length > spreadsheetLimits.cellLength || row.length >= spreadsheetLimits.cols) {
      throw new Error('A CSV cell or row exceeds the spreadsheet limits.')
    }
    row.push(fieldValue)
    value = ''
    closed = false
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { value += text.slice(start, index + 1); index++; start = index + 1 }
        else { value += text.slice(start, index); quoted = false; closed = true }
      }
      continue
    }
    if (char === delimiter) {
      field(index)
      start = index + 1
    } else if (char === '\r' || char === '\n') {
      field(index)
      const ending = char === '\r' && text[index + 1] === '\n' ? '\r\n' : char
      if (ending === '\r\n') index++
      if (receive(row, ending) === false) return
      row = []
      start = index + 1
    } else if (closed) {
      throw new CsvQuotingError('A CSV closing quote must be followed by a delimiter or a line ending.')
    } else if (char === '"') {
      if (index !== start) throw new CsvQuotingError('A CSV quote in an unquoted field must be escaped inside a quoted field.')
      quoted = true
      start = index + 1
    }
  }
  if (quoted) throw new CsvQuotingError('A CSV field has an unclosed quote.')
  if (start < text.length || row.length || closed) {
    field(text.length)
    receive(row)
  }
}

function detectDelimiters(text: string) {
  return delimiters.flatMap(delimiter => {
    const counts = new Map<number, number>()
    let records = 0
    try {
      readRecords(text, delimiter, fields => {
        if (fields.length > 1) counts.set(fields.length, (counts.get(fields.length) ?? 0) + 1)
        return ++records < 32
      })
    } catch { return [] }
    const score = Math.max(0, ...counts.values())
    return [{ delimiter, score, records }]
  }).sort((left, right) => right.score - left.score)
}

export function readCsv(bytes: Uint8Array, delimiter?: CsvDialect['delimiter']): Workbook {
  if (bytes.length > spreadsheetLimits.fileBytes) throw new Error('CSV imports are limited to 16 MiB.')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('CSV imports require valid UTF-8, with or without a UTF-8 BOM.') }
  if (binaryControls.test(text)) throw new Error('The CSV contains binary control characters.')
  if (delimiter && !delimiters.includes(delimiter)) throw new Error('Choose a supported CSV delimiter.')
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191
  if (delimiter) return parseCsv(text, delimiter, bom, false)
  const [first, ...alternatives] = detectDelimiters(text)
  try {
    return parseCsv(text, first?.delimiter ?? ',', bom, !!first?.score &&
      (first.score === alternatives[0]?.score || first.score !== first.records))
  } catch (error) {
    if (!(error instanceof CsvQuotingError)) throw error
    for (const candidate of alternatives) {
      if (candidate.score === 0) break
      try { return parseCsv(text, candidate.delimiter, bom, true) }
      catch (fallback) { if (!(fallback instanceof CsvQuotingError)) throw fallback }
    }
    throw error
  }
}

function parseCsv(text: string, delimiter: CsvDialect['delimiter'], bom: boolean, ambiguous: boolean) {
  const workbook = createWorkbook('csv')
  const sheet = workbook.sheets[0]
  const csv = workbook.csv!
  csv.delimiter = delimiter
  csv.ambiguous = ambiguous
  csv.bom = bom
  workbook.imported = true
  let firstEnding: CsvDialect['lineEnding'] | undefined
  let columns = 0
  let total = 0
  readRecords(text, csv.delimiter, (fields, ending) => {
    const row = csv.rowWidths.length + 1
    total += fields.length
    if (row > spreadsheetLimits.rows || total > spreadsheetLimits.cells) throw new Error('The CSV exceeds the 150,000-field limit.')
    csv.rowWidths.push(fields.length)
    columns = Math.max(columns, fields.length)
    csv.finalNewline = ending !== undefined
    if (ending) {
      firstEnding ??= ending
      if (ending !== firstEnding) csv.mixedLineEndings = true
    }
    fields.forEach((value, index) => {
      if (value) sheet.cells[cellAddress(row, index + 1)] = { kind: 'text', value }
    })
  })
  csv.lineEnding = firstEnding ?? csv.lineEnding
  sheet.rowCount = csv.rowWidths.length
  sheet.colCount = columns
  if (csv.ambiguous) workbook.warnings.push('CSV delimiter detection was ambiguous. Check the detected columns against the original.')
  if (csv.mixedLineEndings) workbook.warnings.push('This CSV uses mixed record endings. Edited copies use the first record ending.')
  return workbook
}

export interface CsvExportOptions {
  sheetId: string
  safety: 'literal' | 'safe'
  delimiter?: CsvDialect['delimiter']
}

export function writeCsv(workbook: Workbook, options: CsvExportOptions): Uint8Array<ArrayBuffer> {
  const sheet = workbook.sheets.find(item => item.id === options.sheetId)
  if (!sheet) throw new Error('Choose a worksheet for the CSV copy.')
  if (options.safety !== 'literal' && options.safety !== 'safe') throw new Error('Choose how to export formula-like CSV values.')
  const dialect = workbook.csv
  const delimiter = options.delimiter ?? dialect?.delimiter ?? ','
  if (!delimiters.includes(delimiter)) throw new Error('Choose a supported CSV delimiter.')
  const ending = dialect?.lineEnding ?? '\r\n'
  const widths = dialect && sheet === workbook.sheets[0] ? dialect.rowWidths.slice(0, sheet.rowCount) : []
  for (const [key, cell] of Object.entries(sheet.cells)) {
    if (cell.kind === 'text' && cell.value === '') continue
    const point = parseAddress(key)
    if (!point) throw new Error('The workbook contains an invalid cell address.')
    widths[point.row - 1] = Math.max(widths[point.row - 1] ?? 0, point.col)
  }
  const quote = (value: string, force: boolean) =>
    force || value.includes(delimiter) || /["\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value
  const lines: string[] = []
  const encoder = new TextEncoder()
  let outputBytes = dialect?.bom ? 3 : 0
  let fields = 0
  for (let row = 1; row <= widths.length; row++) {
    const width = Math.max(1, widths[row - 1] ?? 1)
    fields += width
    if (fields > spreadsheetLimits.cells) throw new Error('CSV exports are limited to 150,000 fields.')
    const values: string[] = []
    for (let col = 1; col <= width; col++) {
      const cell = sheet.cells[cellAddress(row, col)]
      const value = cellInput(cell)
      if (/[\uD800-\uDFFF]/u.test(value) || binaryControls.test(value)) {
        throw new Error('A cell contains invalid Unicode or binary controls.')
      }
      const neutralize = options.safety === 'safe' && typeof cell?.value === 'string' &&
        /^(?:[\t\r\n]|[\s\u200B-\u200D\uFEFF]*[=+\-@＝＋－＠])/u.test(value)
      const loneEmptyFinalField = row === widths.length && width === 1 && value === '' && !dialect?.finalNewline
      const leadingDataBom = row === 1 && col === 1 && value.startsWith('\ufeff') && !dialect?.bom
      const quoted = quote(neutralize ? "'" + value : value, loneEmptyFinalField || leadingDataBom)
      outputBytes += encoder.encode(quoted).length + Number(col > 1)
      if (outputBytes > spreadsheetLimits.fileBytes) throw new Error('CSV exports are limited to 16 MiB.')
      values.push(quoted)
    }
    const lineEnding = row !== widths.length || dialect?.finalNewline ? ending : ''
    outputBytes += lineEnding.length
    if (outputBytes > spreadsheetLimits.fileBytes) throw new Error('CSV exports are limited to 16 MiB.')
    lines.push(values.join(delimiter), lineEnding)
  }
  return encoder.encode((dialect?.bom ? '\ufeff' : '') + lines.join(''))
}
