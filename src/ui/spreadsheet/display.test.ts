import { describe, expect, it } from 'vitest'
import { createSheet } from '../../document/formats/spreadsheet/model'
import { axisMetrics, displayCell, rewriteSheetReferences, ruleAppearance, shiftCsvRows, shiftSheet } from './display'

describe('sheet display and structural edits', () => {
  it('finds visible coordinates across hidden and resized columns', () => {
    const metrics = axisMetrics(10, 100, { 2: 200 }, [3])
    expect(metrics.offset(4)).toBe(300)
    expect(metrics.index(300)).toBe(4)
    expect(metrics.size(3)).toBe(0)
  })

  it('displays workbook date systems without offsetting stored serial dates', () => {
    const cell = { kind: 'date', value: 1, style: { numberFormat: 'yyyy-mm-dd' } } as const
    expect(displayCell(cell, 'en-US', false)).toBe('1900-01-01')
    expect(displayCell(cell, 'en-US', true)).toBe('1904-01-02')
    expect(displayCell({ kind: 'date', value: 60, style: { numberFormat: 'yyyy-mm-dd' } }, 'en-US', false)).toBe('1900-02-29')
    expect(displayCell({ ...cell, style: { numberFormat: 'General' } }, 'en-US', false)).toBe('1')
    expect(displayCell({ ...cell, style: { numberFormat: '0.00' } }, 'en-US', false)).toBe('1.00')
  })

  it('preserves formula input separately from cached or calculated results', () => {
    const cell = { kind: 'formula', value: '=1+1', cached: 3 } as const
    expect(displayCell(cell, 'en-US', false)).toBe('3')
    expect(displayCell(cell, 'en-US', false, 2)).toBe('2')
    expect(displayCell({ kind: 'formula', value: '=1+1' }, 'en-US', false)).toBe('—')
  })

  it('moves cells, dimensions, and intersecting merges for a row insertion', () => {
    const sheet = createSheet('Demo')
    sheet.cells = { B2: { kind: 'text', value: 'Owned' } }
    sheet.heights = { 2: 42 }
    sheet.merges = [{ row: 1, col: 1, endRow: 2, endCol: 2 }]
    const next = shiftSheet(sheet, 'row', 2, true)
    expect(next.cells).toEqual({ B3: { kind: 'text', value: 'Owned' } })
    expect(next.heights).toEqual({ 3: 42 })
    expect(next.merges).toEqual([{ row: 1, col: 1, endRow: 3, endCol: 2 }])
  })

  it('rewrites only direct sheet references and preserves string literals', () => {
    expect(rewriteSheetReferences('=Old!A1+\'OLD\'!C2&"Old!A2"', 'old', "Sam's Data"))
      .toBe('=\'Sam\'\'s Data\'!A1+\'Sam\'\'s Data\'!C2&"Old!A2"')
    expect(rewriteSheetReferences('=SUM(Old!A1:B2)', 'Old')).toBe('=SUM(#REF!)')
    expect(rewriteSheetReferences('=SUM(Other:Old!A1)', 'Old', 'Later')).toBe('=SUM(Other:Old!A1)')
  })

  it('preserves ragged and trailing empty CSV fields through structural edits', () => {
    expect(shiftCsvRows([4, 1, 2], 'col', 3, false)).toEqual([3, 1, 2])
    expect(shiftCsvRows([4, 1, 2], 'col', 2, true)).toEqual([5, 2, 3])
    expect(shiftCsvRows([4, 1, 2], 'row', 2, true)).toEqual([4, 1, 1, 2])
    expect(shiftCsvRows([4, 1, 2], 'row', 2, false)).toEqual([4, 2])
  })

  it('matches text and number equality conditions against only their own cell type', () => {
    const sheet = createSheet('Tests')
    sheet.rules = [
      { id: 'text', operator: 'equal', valueType: 'text', value: '001', color: '#112233', range: { row: 1, col: 1, endRow: 1, endCol: 2 } },
      { id: 'number', operator: 'equal', valueType: 'number', value: '1', color: '#445566', range: { row: 2, col: 1, endRow: 2, endCol: 2 } },
    ]
    const appearance = ruleAppearance(sheet)
    expect(appearance({ row: 1, col: 1 }, { kind: 'text', value: '001' })).toEqual({ color: '#112233' })
    expect(appearance({ row: 1, col: 2 }, { kind: 'number', value: 1 })).toEqual({})
    expect(appearance({ row: 2, col: 1 }, { kind: 'number', value: 1 })).toEqual({ color: '#445566' })
    expect(appearance({ row: 2, col: 2 }, { kind: 'text', value: '1' })).toEqual({})
  })
})
