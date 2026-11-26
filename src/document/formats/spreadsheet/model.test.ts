import { describe, expect, test } from 'vitest'
import { cellAddress, createWorkbook, enterCell, parseRange } from './model'

describe('spreadsheet coordinates and input', () => {
  test('accepts bounded A1 ranges and normalizes reversed coordinates', () => {
    expect(parseRange('AB12:Z2')).toEqual({ row: 2, col: 26, endRow: 12, endCol: 28 })
    expect(cellAddress(12, 28)).toBe('AB12')
    expect(parseRange('XFE1')).toBeUndefined()
    expect(parseRange('A0')).toBeUndefined()
  })

  test('keeps CSV identifiers and formulas literal', () => {
    expect(enterCell('00042', 'csv')).toEqual({ kind: 'text', value: '00042' })
    expect(enterCell('=SUM(A1:A2)', 'csv')).toEqual({ kind: 'text', value: '=SUM(A1:A2)' })
  })

  test('types workbook input without erasing padded identifiers', () => {
    expect(enterCell('00042', 'xlsx')).toEqual({ kind: 'text', value: '00042' })
    expect(enterCell('42', 'xlsx')).toEqual({ kind: 'number', value: 42 })
    expect(enterCell('=SUM(A1:A2)', 'xlsx')).toEqual({ kind: 'formula', value: '=SUM(A1:A2)' })
    expect(enterCell('', 'xlsx')).toBeUndefined()
    expect(createWorkbook('xlsx').sheets[0].name).toBe('Sheet1')
  })
})
