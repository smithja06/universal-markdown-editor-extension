import { readFileSync } from 'node:fs'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { describe, expect, test } from 'vitest'
import { createSheet, createWorkbook } from './model'
import { processSpreadsheet } from './xlsx'

const wasm = new Uint8Array(readFileSync('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))

describe('IronCalc XLSX codec', () => {
  test('round trips sheets, typed values, literal formula-like text, unapplied calculations and formatting', () => {
    const workbook = createWorkbook('xlsx')
    const sheet = workbook.sheets[0]
    workbook.sheets.push(createSheet('Costs 2026'))
    workbook.date1904 = true
    workbook.locale = 'fr-CA'
    workbook.timezone = 'America/Toronto'
    workbook.coreProperties = { title: 'Costs & revenue', creator: 'Finance <team>', created: '2025-01-02T03:04:05Z' }
    sheet.cells.A1 = { kind: 'text', value: '=0020', style: { bold: true, italic: true, underline: true, strike: true,
      font: 'Georgia', color: '#005abb', fill: '#ffeeaa', size: 15, horizontal: 'center', vertical: 'middle', wrap: true,
      borders: { bottom: { color: '#110066', style: 'dashed' } } } }
    sheet.cells.A2 = { kind: 'number', value: 1234.5, style: { numberFormat: '0.00' } }
    sheet.cells.A3 = { kind: 'boolean', value: true }
    sheet.cells.A4 = { kind: 'formula', value: '=A2*2', cached: 42 }
    sheet.cells.A5 = { kind: 'error', value: '#N/A' }
    sheet.cells.A6 = { kind: 'date', value: 1, style: { numberFormat: 'yyyy-mm-dd' } }
    sheet.cells.B1 = { kind: 'text', value: 'Reference', link: 'https://example.org/' }
    sheet.cells.B2 = { kind: 'text', value: '', style: { fill: '#aaee99' } }
    sheet.cells.B3 = { kind: 'formula', value: '="#N/A"', cached: '#N/A' }
    sheet.cells.B4 = { kind: 'formula', value: '=#N/A', cached: '#N/A', cachedError: true }
    sheet.widths[1] = 150
    sheet.heights[2] = 33
    sheet.frozenRows = 1
    sheet.gridLines = false
    sheet.merges = [{ row: 7, col: 1, endRow: 7, endCol: 2 }]
    const ruleRange = { row: 2, col: 1, endRow: 4, endCol: 1 }
    sheet.rules = [
      { id: 'high', range: ruleRange, operator: 'greater', value: '1000', color: '#ffff00' },
      { id: 'match', range: ruleRange, operator: 'equal', value: 'Quote "this"', color: '#88ffcc' },
      { id: 'nearby', range: ruleRange, operator: 'contains', value: 'Reference', color: '#88ffcc' },
      { id: 'repeat', range: ruleRange, operator: 'duplicate', color: '#88ffcc' },
      { id: 'scale', range: ruleRange, operator: 'colorScale', color: '#cc2222', color2: '#55ff99' },
      { id: 'bar', range: ruleRange, operator: 'dataBar', color: '#22cc55' },
    ]

    const output = processSpreadsheet({ operation: 'write', workbook }, wasm)
    if (output.operation !== 'write') throw new Error(JSON.stringify(output))
    const input = processSpreadsheet({ operation: 'read', bytes: output.bytes }, wasm)
    if (input.operation !== 'read') throw new Error(JSON.stringify(input))
    expect(input.workbook.sheets.map(item => item.name)).toEqual(['Sheet1', 'Costs 2026'])
    expect(input.workbook.date1904).toBe(true)
    expect(input.workbook.locale).toBe('fr-CA')
    expect(input.workbook.timezone).toBe('America/Toronto')
    expect(input.workbook.coreProperties).toMatchObject(workbook.coreProperties)
    const restored = input.workbook.sheets[0]
    expect(restored.cells.A1).toMatchObject({ kind: 'text', value: '=0020', style: sheet.cells.A1.style })
    expect(restored.cells.A2).toMatchObject(sheet.cells.A2)
    expect(restored.cells.A3).toMatchObject(sheet.cells.A3)
    expect(restored.cells.A4).toMatchObject(sheet.cells.A4)
    expect(restored.cells.A5).toMatchObject(sheet.cells.A5)
    expect(restored.cells.A6).toMatchObject(sheet.cells.A6)
    expect(restored.cells.B1).toMatchObject(sheet.cells.B1)
    expect(restored.cells.B2).toMatchObject(sheet.cells.B2)
    expect(restored.cells.B3).toEqual(sheet.cells.B3)
    expect(restored.cells.B4).toEqual(sheet.cells.B4)
    expect(restored.merges).toEqual(sheet.merges)
    expect(restored.rules.map(({ operator, value, color, color2 }) => ({ operator, value, color, color2 }))).toEqual(
      sheet.rules.map(({ operator, value, color, color2 }) => ({ operator, value, color, color2 })),
    )
    expect(restored.widths[1]).toBeCloseTo(150, 0)
    expect(restored.heights[2]).toBeCloseTo(33, 0)
    expect(restored.frozenRows).toBe(1)
    expect(restored.gridLines).toBe(false)
  })

  test('rejects a malformed or macro-bearing package and reports omitted features', () => {
    expect(processSpreadsheet({ operation: 'read', bytes: new Uint8Array([0x50, 0x4b]) }, wasm)).toMatchObject({ operation: 'error' })
    const output = processSpreadsheet({ operation: 'write', workbook: createWorkbook('xlsx') }, wasm)
    if (output.operation !== 'write') throw new Error(JSON.stringify(output))
    const parts = unzipSync(output.bytes)
    const charts = processSpreadsheet({ operation: 'read', bytes: zipSync({ ...parts, 'xl/charts/chart1.xml': strToU8('<chart/>') }) }, wasm)
    expect(charts).toMatchObject({ operation: 'read', workbook: { warnings: expect.arrayContaining([expect.stringMatching(/charts/i)]) } })
    expect(processSpreadsheet({ operation: 'read', bytes: zipSync({ ...parts, 'xl/vbaProject.bin': new Uint8Array([0]) }) }, wasm)).toMatchObject({ operation: 'error', message: expect.stringMatching(/macro/i) })
    parts['xl/workbook.xml'] = strToU8(strFromU8(parts['xl/workbook.xml']).replace('<workbook ', '<!DOCTYPE workbook SYSTEM "https://example.invalid"><workbook '))
    expect(processSpreadsheet({ operation: 'read', bytes: zipSync(parts) }, wasm)).toMatchObject({ operation: 'error', message: expect.stringMatching(/DTD/i) })
  })

  test('calculates bounded local references and blocks unqualified external or oversized formulas', () => {
    const workbook = createWorkbook('xlsx')
    const sheet = workbook.sheets[0]
    const costs = createSheet('Costs 2026')
    workbook.sheets.push(costs)
    costs.cells.A1 = { kind: 'number', value: 3 }
    sheet.cells.A1 = { kind: 'number', value: 5 }
    sheet.cells.B1 = { kind: 'formula', value: "=SUM(A1,'Costs 2026'!A1)" }
    sheet.cells.C1 = { kind: 'formula', value: '=1/3' }
    sheet.cells.D1 = { kind: 'formula', value: '=WEBSERVICE("https://example.invalid/")' }
    sheet.cells.E1 = { kind: 'formula', value: '=SUM(A1:A1048576)' }
    sheet.cells.F1 = { kind: 'formula', value: '=SUM(A:A)' }
    sheet.cells.G1 = { kind: 'formula', value: '=SUM(D1:F1)' }
    expect(processSpreadsheet({ operation: 'calculate', workbook }, wasm)).toEqual({
      operation: 'calculate', results: { [sheet.id]: { B1: 8, C1: 1 / 3, D1: '#UNSUPPORTED!', E1: '#UNSUPPORTED!', F1: '#UNSUPPORTED!', G1: '#UNSUPPORTED!' }, [costs.id]: {} },
    })
  })

  test('exports verified current caches on request while retaining unsupported formulas and their stored cache', () => {
    const workbook = createWorkbook('xlsx')
    const sheet = workbook.sheets[0]
    sheet.cells.A1 = { kind: 'formula', value: '=SUM(1,2)', cached: 40 }
    sheet.cells.A2 = { kind: 'formula', value: '=INDIRECT("B1")', cached: 7 }
    const output = processSpreadsheet({ operation: 'write', workbook, includeCalculated: true }, wasm)
    if (output.operation !== 'write') throw new Error(output.message)
    const reopened = processSpreadsheet({ operation: 'read', bytes: output.bytes }, wasm)
    if (reopened.operation !== 'read') throw new Error(reopened.message)
    expect(reopened.workbook.sheets[0].cells).toMatchObject({ A1: { cached: 3 }, A2: { cached: 7 } })
    expect(sheet.cells.A1.cached).toBe(40)
  })

  test('preserves text equality and discloses unsupported sheet defaults', () => {
    const workbook = createWorkbook('xlsx')
    const sheet = workbook.sheets[0]
    sheet.rules = [{ id: 'text', range: { row: 1, col: 1, endRow: 3, endCol: 1 }, color: '#ccffee',
      operator: 'equal', value: '001', valueType: 'text' }]
    const output = processSpreadsheet({ operation: 'write', workbook }, wasm)
    if (output.operation !== 'write') throw new Error(output.message)
    const parts = unzipSync(output.bytes)
    const part = 'xl/worksheets/sheet1.xml'
    const xml = strFromU8(parts[part]).replace(/<sheetFormatPr\b[^>]*\/>/, '')
    parts[part] = strToU8(xml.replace('<sheetData', '<sheetFormatPr defaultColWidth="30" defaultRowHeight="40" customHeight="1"/><sheetData'))
    const read = processSpreadsheet({ operation: 'read', bytes: zipSync(parts) }, wasm)
    if (read.operation !== 'read') throw new Error(read.message)
    expect(read.workbook.sheets[0].rules[0]).toMatchObject({ operator: 'equal', value: '001', valueType: 'text' })
    expect(read.workbook.warnings).toContainEqual(expect.stringMatching(/default row or column/i))
  })

  test('reopens an export with highly compressible cell text', () => {
    const workbook = createWorkbook('xlsx')
    const sheet = workbook.sheets[0]
    for (let row = 1; row <= 10; row++) sheet.cells['A' + row] = { kind: 'text', value: 'a'.repeat(20_000) + row }
    const output = processSpreadsheet({ operation: 'write', workbook }, wasm)
    if (output.operation !== 'write') throw new Error(output.message)
    const reopened = processSpreadsheet({ operation: 'read', bytes: output.bytes }, wasm)
    if (reopened.operation !== 'read') throw new Error(reopened.message)
    const restored = reopened.workbook.sheets[0].cells
    expect(Object.keys(restored)).toEqual(Object.keys(sheet.cells))
    expect(Object.entries(sheet.cells).every(([address, cell]) => restored[address].value === cell.value)).toBe(true)
  })

  test('qualifies the published formula reference through IronCalc', () => {
    const workbook = createWorkbook('xlsx')
    const sheet = workbook.sheets[0]
    sheet.cells.A1 = { kind: 'number', value: 1 }
    sheet.cells.A2 = { kind: 'number', value: 2 }
    sheet.cells.A3 = { kind: 'number', value: 3 }
    sheet.cells.A4 = { kind: 'text', value: '0004' }
    const fixtures = {
      B1: ['=SUM(A1:A4)', 6], B2: ['=ABS(-12)', 12], B3: ['=ROUND(1/3, 2)', 0.33],
      B4: ['=MIN(A1:A4)', 1], B5: ['=MAX(A1:A4)', 3], B6: ['=COUNT(A1:A4)', 3],
      B7: ['=AVERAGE(A1:A4)', 2], B8: ['=IF(A1>0, "Gain", "Loss")', 'Gain'],
      B9: ['=AND(A1>0, A2>0)', true], B10: ['=OR(A1>0, A2<0)', true], B11: ['=NOT(A1=0)', true],
      B12: ['=LEN(A4)', 4], B13: ['=TODAY()', expect.any(Number)], B14: ['=NOW()', expect.any(Number)],
      B15: ['=B16+1', '#UNSUPPORTED!'], B16: ['=B15+1', '#UNSUPPORTED!'],
    } as const
    for (const [address, [value]] of Object.entries(fixtures)) sheet.cells[address] = { kind: 'formula', value }
    expect(processSpreadsheet({ operation: 'calculate', workbook }, wasm)).toEqual({
      operation: 'calculate',
      results: { [sheet.id]: Object.fromEntries(Object.entries(fixtures).map(([address, [, expected]]) => [address, expected])) },
    })
  })
})

describe("workbook themes", () => {
  test('keeps the built-in theme snapshot in sync with IronCalc 0.9.1', async () => {
    const { getThemeList, initSync } = await import('@ironcalc/wasm-xlsx')
    initSync({ module: Uint8Array.from(readFileSync('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm')) })
    const { builtinThemes } = await import('./themes')
    expect(getThemeList()).toEqual(builtinThemes)
  })

  test('writes the chosen theme and reads it back with the workbook', async () => {
    const { builtinThemes } = await import('./themes')
    const wasm = Uint8Array.from(readFileSync('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
    const workbook = createWorkbook('xlsx')
    workbook.theme = builtinThemes.find(theme => theme.name === 'Forest')!
    workbook.sheets[0].cells.A1 = { kind: 'text', value: 'Themed', style: { fill: '#3a6b35' } }
    const written = processSpreadsheet({ operation: 'write', workbook }, wasm)
    if (written.operation !== 'write') throw new Error(written.message)
    expect(strFromU8(unzipSync(written.bytes)['xl/theme/theme1.xml'])).toContain('3A6B35')
    const read = processSpreadsheet({ operation: 'read', bytes: written.bytes }, wasm)
    if (read.operation !== 'read') throw new Error(read.message)
    expect(read.workbook.theme).toEqual(workbook.theme)
    expect(read.workbook.sheets[0].cells.A1?.style?.fill?.toLowerCase()).toBe('#3a6b35')
    expect(read.workbook.warnings.join(' ')).not.toMatch(/theme/i)
    expect(processSpreadsheet({ operation: 'write', workbook: { ...workbook, theme: { ...workbook.theme, accent1: 'red' } } }, wasm))
      .toMatchObject({ operation: 'error', message: 'The workbook theme is invalid.' })
  })
})
