// @vitest-environment node
import { readFileSync } from 'node:fs'
import { initSync } from '@ironcalc/wasm-xlsx'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSheet, createWorkbook, type Workbook } from './model'
import { restructureFormulas, StructureRefusal } from './restructure'
import { processSpreadsheet } from './xlsx'

const wasm = Uint8Array.from(readFileSync('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
beforeAll(() => { initSync({ module: wasm }) })

function workbook(formulas: Record<string, string>, data: Record<string, string> = {}): Workbook {
  const book = createWorkbook('xlsx')
  const other = createSheet('Data Sheet')
  book.sheets.push(other)
  for (const [address, value] of Object.entries(formulas)) book.sheets[0].cells[address] = { kind: 'formula', value }
  for (const [address, value] of Object.entries(data)) other.cells[address] = { kind: 'formula', value }
  return book
}

describe('formula-aware structural edits', () => {
  const book = workbook({
    D10: '=a1 + B2', D11: '=$A$1+$B$2', D12: '=$A1+B$2', D13: '=SUM(A1:A5)', D14: '=SUM($A$1:$A$5)',
    D15: "='Data Sheet'!A1+'Data Sheet'!$B$3", D16: '=IF(A3>0, "A3", A4)', D17: '=foo(A3)',
  }, { E1: '=Sheet1!A3+Sheet1!$A$4' })
  const [main, data] = book.sheets

  it('inserts a row and updates relative, absolute, mixed, range and cross-sheet references', () => {
    const updates = restructureFormulas(book, { kind: 'insert', sheetId: main.id, axis: 'row', index: 2 })
    expect(updates[main.id]).toEqual({
      D11: '=a1 + B3', D12: '=$A$1+$B$3', D13: '=$A1+B$3', D14: '=SUM(A1:A6)', D15: '=SUM($A$1:$A$6)',
      D17: '=IF(A4>0, "A3", A5)', D18: '=foo(A4)',
    })
    expect(updates[data.id]).toEqual({ E1: '=Sheet1!A4+Sheet1!$A$5' })
  })

  it('deletes a row or column and turns removed references into #REF!', () => {
    const rows = restructureFormulas(book, { kind: 'delete', sheetId: main.id, axis: 'row', index: 3 })
    expect(rows[main.id].D12).toBe('=SUM(A1:A4)')
    expect(rows[main.id].D15).toBe('=IF(#REF!>0, "A3", A3)')
    expect(rows[data.id]).toEqual({ E1: '=#REF!+Sheet1!$A$3' })
    const cols = restructureFormulas(book, { kind: 'delete', sheetId: main.id, axis: 'col', index: 2 })
    expect(cols[main.id].C10).toBe('=a1 + #REF!')
    const inserted = restructureFormulas(book, { kind: 'insert', sheetId: main.id, axis: 'col', index: 1 })
    expect(inserted[main.id].E13).toBe('=SUM(B1:B5)')
  })

  it('updates references on other sheets when the referenced sheet changes', () => {
    const updates = restructureFormulas(book, { kind: 'insert', sheetId: data.id, axis: 'row', index: 1 })
    expect(updates[main.id]).toEqual({ D15: "='Data Sheet'!A2+'Data Sheet'!$B$4" })
    const renamed = restructureFormulas(book, { kind: 'rename', sheetId: data.id, name: 'Inputs' })
    expect(renamed[main.id]).toEqual({ D15: '=Inputs!A1+Inputs!$B$3' })
  })

  it('keeps the operation unavailable for references it cannot update', () => {
    for (const formula of ['=INDIRECT("A1")', '=SUM(OFFSET(A1,1,0))', '=Table1[Amount]', '=[1]Sheet1!A1']) {
      expect(() => restructureFormulas(workbook({ A1: formula }), { kind: 'insert', sheetId: workbook({}).sheets[0].id, axis: 'row', index: 1 }))
        .toThrow(StructureRefusal)
    }
    const single = workbook({ B1: '=INDIRECT("A1")' })
    expect(() => restructureFormulas(single, { kind: 'insert', sheetId: single.sheets[0].id, axis: 'row', index: 1 })).toThrow(/INDIRECT or OFFSET/)
  })

  it('round-trips the updated formulas through an XLSX copy', () => {
    const updates = restructureFormulas(book, { kind: 'insert', sheetId: main.id, axis: 'row', index: 2 })
    const next = structuredClone(book)
    next.sheets[0].cells = Object.fromEntries(Object.entries(updates[main.id]).map(([address, value]) => [address, { kind: 'formula' as const, value }]))
    const written = processSpreadsheet({ operation: 'write', workbook: next }, wasm)
    if (written.operation !== 'write') throw new Error(written.message)
    const read = processSpreadsheet({ operation: 'read', bytes: written.bytes }, wasm)
    if (read.operation !== 'read') throw new Error(read.message)
    expect(read.workbook.sheets[0].cells.D14?.value).toBe('=SUM(A1:A6)')
    expect(read.workbook.sheets[0].cells.D17?.value).toBe('=IF(A4>0, "A3", A5)')
  })
})
