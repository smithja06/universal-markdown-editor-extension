// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogFunction, formulaArguments, formulaCatalog } from './formulaCatalog'
import { createWorkbook, type Cell } from './model'
import { processSpreadsheet } from './xlsx'

const wasm = Uint8Array.from(readFileSync('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))

// Each admitted function evaluated through Folio's calculation worker path against the bundled IronCalc 0.9.1.
const cases: Record<string, [string, string | number | boolean]> = {
  SUM: ['=SUM(A1:A2)', 7], PRODUCT: ['=PRODUCT(A1:A2)', 12], SUMPRODUCT: ['=SUMPRODUCT(A1:A2, A1:A2)', 25],
  SUMIF: ['=SUMIF(A1:A2, ">3")', 4], SUMIFS: ['=SUMIFS(A1:A2, A1:A2, ">3")', 4], ABS: ['=ABS(-12)', 12],
  ROUND: ['=ROUND(2.345, 2)', 2.35], ROUNDUP: ['=ROUNDUP(2.21, 1)', 2.3], ROUNDDOWN: ['=ROUNDDOWN(2.29, 1)', 2.2],
  INT: ['=INT(2.7)', 2], MOD: ['=MOD(7, 3)', 1], POWER: ['=POWER(2, 8)', 256], SQRT: ['=SQRT(16)', 4],
  PI: ['=ROUND(PI(), 6)', 3.141593], MIN: ['=MIN(A1:A2)', 3], MAX: ['=MAX(A1:A2)', 4], COUNT: ['=COUNT(A1:A4)', 2],
  COUNTA: ['=COUNTA(A1:A4)', 3], COUNTBLANK: ['=COUNTBLANK(A1:A4)', 1], COUNTIF: ['=COUNTIF(A1:A2, ">3")', 1],
  COUNTIFS: ['=COUNTIFS(A1:A2, ">2")', 2], AVERAGE: ['=AVERAGE(A1:A2)', 3.5], AVERAGEIF: ['=AVERAGEIF(A1:A2, ">3")', 4],
  MEDIAN: ['=MEDIAN(A1:A2, 10)', 4], IF: ['=IF(A1>2, "Gain", "Loss")', 'Gain'], IFS: ['=IFS(FALSE, 1, TRUE, 2)', 2],
  IFERROR: ['=IFERROR(1/0, "bad")', 'bad'], SWITCH: ['=SWITCH(2, 1, "a", 2, "b")', 'b'], AND: ['=AND(A1>0, A2>0)', true],
  OR: ['=OR(A1>9, A2>3)', true], XOR: ['=XOR(TRUE, TRUE)', false], NOT: ['=NOT(A1=0)', true], ISBLANK: ['=ISBLANK(A4)', true],
  ISNUMBER: ['=ISNUMBER(A1)', true], ISTEXT: ['=ISTEXT(A3)', true], LEN: ['=LEN(A3)', 5], LEFT: ['=LEFT("hello", 2)', 'he'],
  RIGHT: ['=RIGHT("hello", 2)', 'lo'], MID: ['=MID("hello", 2, 3)', 'ell'], UPPER: ['=UPPER("ab")', 'AB'], LOWER: ['=LOWER("AB")', 'ab'],
  TRIM: ['=TRIM("  a  b ")', 'a b'], CONCAT: ['=CONCAT("a", "b")', 'ab'], CONCATENATE: ['=CONCATENATE(A3, "!")', 'apple!'],
  TEXTJOIN: ['=TEXTJOIN("-", TRUE, "a", "b")', 'a-b'], FIND: ['=FIND("l", "hello")', 3], SEARCH: ['=SEARCH("L", "hello")', 3],
  SUBSTITUTE: ['=SUBSTITUTE("aa", "a", "b")', 'bb'], REPT: ['=REPT("ab", 2)', 'abab'], EXACT: ['=EXACT("a", "A")', false],
  VLOOKUP: ['=VLOOKUP(4, A1:B2, 2, FALSE)', 'y'], HLOOKUP: ['=HLOOKUP(3, A1:B2, 2, FALSE)', 4], INDEX: ['=INDEX(A1:B2, 2, 2)', 'y'],
  MATCH: ['=MATCH(4, A1:A2, 0)', 2], DATE: ['=DATE(2024, 2, 29)', 45351], YEAR: ['=YEAR(45351)', 2024], MONTH: ['=MONTH(45351)', 2],
  DAY: ['=DAY(45351)', 29], WEEKDAY: ['=WEEKDAY(45351)', 5], TODAY: ['=TODAY()>45000', true], NOW: ['=NOW()>45000', true],
}

function calculate(date1904 = false) {
  const workbook = createWorkbook('xlsx')
  workbook.date1904 = date1904
  const cells: Record<string, Cell> = {
    A1: { kind: 'number', value: 3 }, A2: { kind: 'number', value: 4 }, A3: { kind: 'text', value: 'apple' },
    B1: { kind: 'text', value: 'x' }, B2: { kind: 'text', value: 'y' },
  }
  Object.values(cases).forEach(([formula], index) => { cells['D' + (index + 1)] = { kind: 'formula', value: formula } })
  workbook.sheets[0].cells = cells
  const reply = processSpreadsheet({ operation: 'calculate', workbook }, wasm)
  if (reply.operation !== 'calculate') throw new Error(reply.message)
  return reply.results[workbook.sheets[0].id]
}

describe('verified formula catalog', () => {
  it('covers every admitted function with a pinned IronCalc 0.9.1 result', () => {
    expect(Object.keys(cases).sort()).toEqual(formulaCatalog.map(entry => entry.name).sort())
    const results = calculate()
    Object.entries(cases).forEach(([name, [, expected]], index) => {
      expect({ name, value: results['D' + (index + 1)] }).toEqual({ name, value: expected })
    })
  })

  it('keeps 1900-only date functions unsupported in 1904 workbooks', () => {
    const results = calculate(true)
    Object.entries(cases).forEach(([name], index) => {
      if (catalogFunction(name)?.date1900) expect({ name, value: results['D' + (index + 1)] }).toEqual({ name, value: '#UNSUPPORTED!' })
    })
    expect(results.D1).toBe(7)
  })

  it('derives argument hints from the documented syntax', () => {
    expect(formulaArguments(catalogFunction('sumif')!)).toEqual(['range', 'criteria', '[sum_range]'])
    expect(formulaArguments(catalogFunction('PI')!)).toEqual([])
  })
})
