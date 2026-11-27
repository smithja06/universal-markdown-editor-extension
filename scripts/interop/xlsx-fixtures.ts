// Writes synthetic XLSX fixtures through Folio's own workbook pipeline for independent checks in Microsoft Excel.
// Run with `npm run interop:xlsx -- <output directory>`. Every value here is invented demonstration data.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { initSync } from '@ironcalc/wasm-xlsx'
import { createSheet, createWorkbook, type Sheet, type Workbook } from '../../src/document/formats/spreadsheet/model'
import { restructureFormulas, type FormulaUpdates, type StructureChange } from '../../src/document/formats/spreadsheet/restructure'
import { builtinThemes, themeTint } from '../../src/document/formats/spreadsheet/themes'
import { processSpreadsheet } from '../../src/document/formats/spreadsheet/xlsx'
import { shiftSheet } from '../../src/ui/spreadsheet/display'

const out = resolve(process.argv[2] ?? 'test-results/interop/xlsx')
mkdirSync(out, { recursive: true })
const wasm = Uint8Array.from(readFileSync(resolve('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm')))
initSync({ module: wasm })

function write(name: string, workbook: Workbook, includeCalculated = true) {
  const result = processSpreadsheet({ operation: 'write', workbook, includeCalculated }, wasm)
  if (result.operation !== 'write') throw new Error(`${name}: ${result.message}`)
  writeFileSync(join(out, name), result.bytes)
  writeFileSync(join(out, name.replace(/\.xlsx$/, '.folio.json')), JSON.stringify(workbook, null, 2))
  process.stdout.write(`wrote ${name} ${result.bytes.byteLength} bytes\n`)
  reopen(name, workbook, result.bytes)
}

/** Reimports the written file through Folio and compares the supported semantic content with the model it came from. */
function reopen(name: string, expected: Workbook, bytes: Uint8Array<ArrayBuffer>) {
  const read = processSpreadsheet({ operation: 'read', bytes }, wasm)
  if (read.operation !== 'read') throw new Error(`${name} reopen: ${read.message}`)
  const problems: string[] = []
  const actual = read.workbook
  if (JSON.stringify(actual.sheets.map(sheet => sheet.name)) !== JSON.stringify(expected.sheets.map(sheet => sheet.name))) problems.push('sheet names or order')
  if (actual.theme?.name !== expected.theme?.name) problems.push('theme')
  expected.sheets.forEach((sheet, index) => {
    const other = actual.sheets[index]
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const got = other.cells[address]
      if (cell.kind === 'formula' ? got?.value !== cell.value : String(got?.value ?? '') !== String(cell.value)) problems.push(`${sheet.name}!${address} value`)
      for (const key of ['bold', 'italic', 'numberFormat', 'font'] as const) {
        if (cell.style?.[key] !== undefined && got?.style?.[key] !== cell.style[key]) problems.push(`${sheet.name}!${address} ${key}`)
      }
      if (cell.style?.fill && got?.style?.fill?.toLowerCase() !== cell.style.fill.toLowerCase()) problems.push(`${sheet.name}!${address} fill`)
    }
    if (JSON.stringify(other.merges) !== JSON.stringify(sheet.merges)) problems.push(`${sheet.name} merges`)
    if (other.rules.length !== sheet.rules.length) problems.push(`${sheet.name} conditional rules`)
  })
  if (problems.length) throw new Error(`${name} did not reopen with the same content: ${problems.join(', ')}`)
  process.stdout.write(`reopened ${name} in Folio: sheets, values, formulas, styles, merges, rules and theme match\n`)
}

/** Applies a structural change the way the editor does: IronCalc reference updates, then the shifted sheet. */
function restructure(workbook: Workbook, change: StructureChange): Workbook {
  const updates: FormulaUpdates = restructureFormulas(workbook, change)
  const sheets = workbook.sheets.map(sheet => {
    let next: Sheet = sheet
    if (sheet.id === change.sheetId && change.kind !== 'rename') next = shiftSheet(sheet, change.axis, change.index, change.kind === 'insert')
    if (change.kind === 'rename' && sheet.id === change.sheetId) next = { ...next, name: change.name }
    const changed = updates[sheet.id]
    if (!changed) return next
    const cells = { ...next.cells }
    for (const [address, value] of Object.entries(changed)) cells[address] = { ...cells[address], kind: 'formula', value, cached: undefined }
    return { ...next, cells }
  })
  return { ...workbook, sheets }
}

// 1. Values, formats, fonts, colors, borders, merges, conditional rules and a theme.
const theme = builtinThemes.find(item => item.name === 'Forest')!
const features = createWorkbook('xlsx')
features.theme = theme
const summary = features.sheets[0]
summary.name = 'Summary'
const data = createSheet('Data 2026')
const notes = createSheet('Notes')
features.sheets.push(data, notes)
const border = { color: '#40564a', style: 'thin' as const }
Object.assign(summary.cells, {
  A1: { kind: 'text', value: 'Folio interop fixture', style: { bold: true, size: 16, font: 'Georgia', color: theme.dk2.toLowerCase() } },
  A2: { kind: 'text', value: 'Identifier' }, B2: { kind: 'text', value: '00420' },
  A3: { kind: 'text', value: 'Amount' }, B3: { kind: 'number', value: 1234.5, style: { numberFormat: '#,##0.00' } },
  A4: { kind: 'text', value: 'Price' }, B4: { kind: 'number', value: 19.99, style: { numberFormat: '"$"#,##0.00' } },
  A5: { kind: 'text', value: 'Rate' }, B5: { kind: 'number', value: 0.125, style: { numberFormat: '0.00%' } },
  A6: { kind: 'text', value: 'Approved' }, B6: { kind: 'boolean', value: true },
  A7: { kind: 'text', value: 'Due (serial)' }, B7: { kind: 'number', value: 46352, style: { numberFormat: 'yyyy-mm-dd' } },
  A8: { kind: 'text', value: 'Due (ISO)' }, B8: { kind: 'date', value: '2026-11-26', style: { numberFormat: 'yyyy-mm-dd' } },
  A9: { kind: 'text', value: 'Styled', style: { italic: true, underline: true, strike: true } },
  B9: { kind: 'text', value: 'Fill', style: { fill: '#3a6b35', color: '#ffffff', bold: true, horizontal: 'center', vertical: 'middle', wrap: true } },
  A10: { kind: 'text', value: 'Accent', style: { color: theme.dk2.toLowerCase(), fill: themeTint(theme.accent2, 0.8) } },
  A11: { kind: 'text', value: 'Boxed', style: { borders: { top: border, right: border, bottom: { color: '#9b3240', style: 'double' }, left: border } } },
  A12: { kind: 'text', value: 'Merged heading', style: { bold: true, horizontal: 'center' } },
  A14: { kind: 'formula', value: "=SUM('Data 2026'!B2:B4)", cached: 60 },
  A15: { kind: 'formula', value: '=ROUND(B3*B5, 2)', cached: 154.31 },
  A16: { kind: 'formula', value: '=IF(B6, "Yes", "No")', cached: 'Yes' },
  A17: { kind: 'formula', value: "=COUNTIF('Data 2026'!B2:B4, \">15\")", cached: 2 },
  C2: { kind: 'number', value: 5 }, C3: { kind: 'number', value: 20 }, C4: { kind: 'number', value: 35 },
})
summary.merges = [{ row: 12, col: 1, endRow: 12, endCol: 3 }]
summary.widths = { 1: 160, 2: 120 }
summary.rules = [
  { id: crypto.randomUUID(), range: { row: 2, col: 3, endRow: 4, endCol: 3 }, operator: 'greater', value: '10', valueType: 'number', color: '#f7dddf' },
  { id: crypto.randomUUID(), range: { row: 2, col: 4, endRow: 4, endCol: 4 }, operator: 'colorScale', color: '#f8696b', color2: '#63be7b' },
]
for (const [address, value] of Object.entries({ D2: 1, D3: 2, D4: 3 })) summary.cells[address] = { kind: 'number', value }
Object.assign(data.cells, {
  A1: { kind: 'text', value: 'Item' }, B1: { kind: 'text', value: 'Value' },
  A2: { kind: 'text', value: 'North' }, B2: { kind: 'number', value: 10 },
  A3: { kind: 'text', value: 'South' }, B3: { kind: 'number', value: 20 },
  A4: { kind: 'text', value: 'East' }, B4: { kind: 'number', value: 30 },
})
notes.cells.A1 = { kind: 'text', value: 'Third worksheet keeps its order.' }
write('folio-features.xlsx', features)

// 2. Formula-aware structure edits through IronCalc: insert a row in the referenced sheet, insert and delete columns, rename.
let edited = restructure(features, { kind: 'insert', sheetId: data.id, axis: 'row', index: 3 })
edited = { ...edited, sheets: edited.sheets.map(sheet => sheet.id === data.id ? { ...sheet, cells: { ...sheet.cells, A3: { kind: 'text', value: 'Inserted' }, B3: { kind: 'number', value: 5 } } } : sheet) }
edited = restructure(edited, { kind: 'insert', sheetId: summary.id, axis: 'col', index: 1 })
edited = restructure(edited, { kind: 'delete', sheetId: summary.id, axis: 'col', index: 1 })
edited = restructure(edited, { kind: 'rename', sheetId: data.id, name: 'Data Renamed' })
write('folio-structure.xlsx', edited)
