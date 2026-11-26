import { test, expect } from 'vitest'
import { createWorkbook } from '../../document/formats/spreadsheet/model'
import { isSpreadsheetClientMessage, readSpreadsheetSnapshot } from './spreadsheetProtocol'

test('spreadsheet copy requests require a single safe filename and explicit CSV text handling', () => {
  const sheetId = createWorkbook('csv').sheets[0].id
  const request = { type: 'spreadsheetExport', id: 1, revision: 1, format: 'csv', filename: 'Quarter 1 copy.csv', sheetId, safety: 'safe' }
  expect(isSpreadsheetClientMessage(request)).toBe(true)
  expect(isSpreadsheetClientMessage({ ...request, filename: '../Quarter 1 copy.csv' })).toBe(false)
  expect(isSpreadsheetClientMessage({ ...request, filename: 'AUX.csv' })).toBe(false)
  expect(isSpreadsheetClientMessage({ ...request, filename: 'Quarter 1 copy.xlsx' })).toBe(false)
  expect(isSpreadsheetClientMessage({ ...request, safety: undefined })).toBe(false)
  const xlsx = { type: 'spreadsheetExport', id: 2, revision: 1, format: 'xlsx', filename: 'Calculation copy.xlsx', sheetId }
  expect(isSpreadsheetClientMessage({ ...xlsx, includeCalculated: true })).toBe(true)
  expect(isSpreadsheetClientMessage({ ...xlsx, includeCalculated: 'true' })).toBe(false)
})

test('host snapshots reject out-of-bounds addresses, duplicate worksheets, and unsafe hyperlink destinations', () => {
  const workbook = createWorkbook('xlsx')
  expect(readSpreadsheetSnapshot(JSON.stringify(workbook))).toEqual(workbook)
  expect(() => readSpreadsheetSnapshot(JSON.stringify({ ...workbook, sheets: [...workbook.sheets, workbook.sheets[0]] }))).toThrow()
  const sheet = workbook.sheets[0]
  sheet.cells.XFE1 = { kind: 'text', value: 'Outside Excel' }
  expect(() => readSpreadsheetSnapshot(JSON.stringify(workbook))).toThrow()
  delete sheet.cells.XFE1
  sheet.cells.A1 = { kind: 'text', value: 'Unsafe', link: 'javascript:alert(1)' }
  expect(() => readSpreadsheetSnapshot(JSON.stringify(workbook))).toThrow()
})
