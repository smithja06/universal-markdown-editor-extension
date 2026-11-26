import { Model } from '@ironcalc/wasm-xlsx'
import { unzipSync, zipSync } from 'fflate'
import { cellAddress, parseAddress, rangeSize, safeSpreadsheetLink, spreadsheetLimits, type Cell, type CellValue, type Sheet, type Workbook } from './model'
import { addConditionalRule, encodeStyle } from './xlsxStyles'
import { child, children, element, spreadsheetZip, xmlBytes, xmlReader } from './xlsxXml'
import { writeWorkbookMetadata } from './xlsxMetadata'

// The package writer requires valid XML 1.0 text, including no unpaired surrogates.
// eslint-disable-next-line no-control-regex
const invalidXmlText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u
const excelErrors = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!', '#BLOCKED!', '#CONNECT!', '#FIELD!', '#UNKNOWN!', '#BUSY!'])

export function validateWorkbook(workbook: Workbook) {
  if (!workbook.sheets.length || workbook.sheets.length > spreadsheetLimits.sheets) throw new Error('The workbook has an unsupported sheet count.')
  const names = new Set<string>()
  let count = 0
  let metadataCharacters = 0
  for (const sheet of workbook.sheets) {
    if (names.has(sheet.name.toLowerCase()) || !sheet.name.trim() || sheet.name.length > 31 || /[\\/?*[\]:\p{Cc}]/u.test(sheet.name) || /^'|'$/.test(sheet.name)) {
      throw new Error('Use unique, valid Excel worksheet names of up to 31 characters.')
    }
    names.add(sheet.name.toLowerCase())
    const addresses = Object.entries(sheet.cells)
    count += addresses.length
    if (count > spreadsheetLimits.cells) throw new Error('The workbook has too many populated or formatted cells.')
    for (const [address, cell] of addresses) {
      if (!parseAddress(address)) throw new Error('A workbook cell has an invalid address.')
      const value = String(cell.value)
      metadataCharacters += value.length + (cell.style?.numberFormat?.length ?? 0) + (cell.style?.font?.length ?? 0) + (cell.link?.length ?? 0)
      if (value.length > spreadsheetLimits.cellLength || invalidXmlText.test(value) || typeof cell.value === 'number' && !Number.isFinite(cell.value)) throw new Error('A workbook cell exceeds the XLSX text limit or has an invalid value.')
      if (cell.kind === 'formula' && (!value.startsWith('=') || value.length < 2 || value.length > 8193)) throw new Error('A formula is missing its expression or exceeds the XLSX formula length limit.')
      if (cell.cached !== undefined && (String(cell.cached).length > spreadsheetLimits.cellLength || invalidXmlText.test(String(cell.cached)) || typeof cell.cached === 'number' && !Number.isFinite(cell.cached))) {
        throw new Error('A formula cache exceeds the XLSX text limit or has an invalid value.')
      }
      if (cell.style?.font && (cell.style.font.length > 128 || invalidXmlText.test(cell.style.font)) ||
        cell.style?.numberFormat && (cell.style.numberFormat.length > 255 || invalidXmlText.test(cell.style.numberFormat))) {
        throw new Error('A workbook cell has an unsupported font name or number format.')
      }
      if (cell.link && !safeSpreadsheetLink(cell.link)) throw new Error('A workbook cell contains an unsupported hyperlink.')
    }
    if (metadataCharacters > 16_000_000 || sheet.rules.length > 512 || sheet.merges.length > 2_000 ||
      Object.keys(sheet.widths).length + Object.keys(sheet.heights).length + (sheet.hiddenCols?.length ?? 0) + (sheet.hiddenRows?.length ?? 0) > 40_000) {
      throw new Error('The workbook exceeds spreadsheet size limits.')
    }
    for (const range of [...sheet.merges, ...sheet.rules.map(rule => rule.range)]) {
      if (!Number.isInteger(range.row) || !Number.isInteger(range.col) || !Number.isInteger(range.endRow) || !Number.isInteger(range.endCol) ||
        range.row < 1 || range.col < 1 || range.endRow < range.row || range.endCol < range.col ||
        range.endRow > spreadsheetLimits.rows || range.endCol > spreadsheetLimits.cols) throw new Error('A worksheet has an invalid range.')
    }
    if (sheet.merges.some(range => rangeSize(range) > spreadsheetLimits.rangeCells) || sheet.merges.reduce((sum, range) => sum + rangeSize(range), 0) > 200_000) {
      throw new Error('A worksheet exceeds the merged-cell size limit.')
    }
  }
}

export function createEngine(workbook: Workbook, timezone = 'UTC') {
  const model = new Model('Workbook', 'en', timezone, 'en')
  try {
    model.pauseEvaluation()
    for (let index = 1; index < workbook.sheets.length; index++) model.newSheet()
    // Temporary names prevent user sheet names from colliding with the generated ones.
    const prefix = '_Folio' + crypto.randomUUID().slice(0, 8) + '_'
    workbook.sheets.forEach((_, index) => model.renameSheet(index, prefix + index))
    workbook.sheets.forEach((sheet, index) => model.renameSheet(index, sheet.name))
    return model
  } catch (error) {
    model.free()
    throw error
  }
}

export function setLiteral(model: Model, sheet: number, row: number, col: number, cell: Cell) {
  if (cell.kind === 'text' && cell.value !== '') model.setUserInput(sheet, row, col, "'" + cell.value)
  else if (cell.kind === 'boolean') model.setUserInput(sheet, row, col, cell.value ? 'TRUE' : 'FALSE')
  else if (cell.kind === 'error' || cell.kind === 'formula' || cell.kind === 'date' && typeof cell.value === 'string') model.setUserInput(sheet, row, col, '0')
  else if (cell.kind !== 'text') model.setUserInput(sheet, row, col, String(cell.value))
}

function applySheet(model: Model, index: number, sheet: Sheet) {
  const base = model.getCellStyle(index, 1, 1).style
  for (const [column, width] of Object.entries(sheet.widths)) model.setColumnsWidth(index, Number(column), Number(column), width)
  for (const [row, height] of Object.entries(sheet.heights)) model.setRowsHeight(index, Number(row), Number(row), height)
  for (const column of sheet.hiddenCols ?? []) model.setColumnsHidden(index, column, column, true)
  for (const row of sheet.hiddenRows ?? []) model.setRowsHidden(index, row, row, true)
  model.setShowGridLines(index, sheet.gridLines)
  model.setFrozenRowsCount(index, sheet.frozenRows)
  model.setFrozenColumnsCount(index, sheet.frozenCols)
  model.setSelectedSheet(index)
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const { row, col } = parseAddress(address)!
    setLiteral(model, index, row, col, cell)
    if (cell.link) model.setCellLink(index, row, col, { type: 'External', target: cell.link })
    if (cell.style) {
      model.setSelectedCell(row, col)
      model.onPasteStyles([[encodeStyle(cell.style, base)]])
    }
  }
  for (const range of sheet.merges) {
    const { row, col, endRow, endCol } = range
    for (let indexRow = row; indexRow <= endRow; indexRow++) for (let indexCol = col; indexCol <= endCol; indexCol++) {
      if (indexRow === row && indexCol === col) continue
      const cell = sheet.cells[cellAddress(indexRow, indexCol)]
      if (cell && cell.value !== '') throw new Error('A merged range contains hidden values. Unmerge to preserve every cell before exporting.')
    }
    model.mergeCells({ sheet: index, row, column: col, width: endCol - col + 1, height: endRow - row + 1 })
  }
  for (const rule of [...sheet.rules].reverse()) addConditionalRule(model, index, rule)
}

function cacheType(value: CellValue, error?: boolean) {
  if (typeof value === 'boolean') return 'b'
  if (typeof value === 'number') return 'n'
  return error && excelErrors.has(value) ? 'e' : 'str'
}

function setValue(node: ReturnType<typeof element>, type: string, value?: CellValue, formula?: string) {
  node.attrs.t = type
  delete node.attrs.cm
  delete node.attrs.vm
  node.children = []
  node.text = ''
  if (formula !== undefined) node.children.push(element('f', {}, formula.slice(1)))
  if (value !== undefined) node.children.push(element('v', {}, value === true ? '1' : value === false ? '0' : String(value)))
}

/** Use IronCalc's writer for workbook structure and styles, keeping raw formulas inert. */
export function exportXlsx(workbook: Workbook) {
  validateWorkbook(workbook)
  const model = createEngine(workbook)
  try {
    workbook.sheets.forEach((sheet, index) => applySheet(model, index, sheet))
    model.setSelectedSheet(0)
    const enginePackage = model.toXlsx()
    if (enginePackage.length > spreadsheetLimits.fileBytes) throw new Error('The XLSX copy exceeds the 16 MiB size limit.')
    const parts = unzipSync(enginePackage)
    const parse = xmlReader()
    const workbookPart = 'xl/workbook.xml'
    const metadata = parse(parts[workbookPart])
    if (workbook.date1904) metadata.children.unshift(element('workbookPr', { date1904: '1' }))
    const calc = child(metadata, 'calcPr')
    if (calc) calc.attrs.calcMode = 'manual'
    parts[workbookPart] = xmlBytes(metadata)
    writeWorkbookMetadata(workbook, parts, parse)
    workbook.sheets.forEach((sheet, index) => {
      const path = `xl/worksheets/sheet${index + 1}.xml`
      const root = parse(parts[path])
      for (const row of children(child(root, 'sheetData'), 'row')) for (const node of children(row, 'c')) {
        const cell = sheet.cells[node.attrs.r]
        if (!cell) continue
        if (cell.kind === 'formula') setValue(node, cell.cached === undefined ? 'n' : cacheType(cell.cached, cell.cachedError), cell.cached, String(cell.value))
        else if (cell.kind === 'error') setValue(node, 'e', excelErrors.has(String(cell.value)) ? cell.value : '#VALUE!')
        else if (cell.kind === 'date' || cell.kind === 'number') setValue(node, typeof cell.value === 'string' ? 'd' : 'n', cell.value)
      }
      parts[path] = xmlBytes(root)
    })
    let result = zipSync(parts)
    if (result.length > spreadsheetLimits.fileBytes) throw new Error('The XLSX copy exceeds the 16 MiB size limit.')
    try { spreadsheetZip(result).verifyRemaining() }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('compression ratio limit')) throw error
      result = zipSync(parts, { level: 0 })
      if (result.length > spreadsheetLimits.fileBytes) throw new Error('The XLSX copy exceeds the 16 MiB size limit.', { cause: error })
      spreadsheetZip(result).verifyRemaining()
    }
    return result
  } finally { model.free() }
}
