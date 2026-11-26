import { expect, test } from 'vitest'
import { readCsv, writeCsv } from './csv'

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

test('preserves delimiters, BOM, embedded newlines, literal identifiers and trailing empty fields', () => {
  const original = '\uFEFFid;notes;\r\n00042;"line 1\r\n""line 2""";\r\n'
  const workbook = readCsv(encode(original))
  const sheet = workbook.sheets[0]
  expect(workbook.csv).toMatchObject({ delimiter: ';', lineEnding: '\r\n', bom: true, rowWidths: [3, 3] })
  expect(sheet.cells.A2).toMatchObject({ kind: 'text', value: '00042' })
  expect(sheet.cells.B2.value).toBe('line 1\r\n"line 2"')
  expect(decode(writeCsv(workbook, { sheetId: sheet.id, safety: 'literal' }))).toBe(original)
})

test('marks ties in delimiter detection and allows manual correction', () => {
  expect(readCsv(encode('a,b;c\nx,y;z')).csv?.ambiguous).toBe(true)
  const workbook = readCsv(encode('a,b;c\nx,y;z'), ';')
  expect(workbook.sheets[0].cells.A2.value).toBe('x,y')
  expect(workbook.csv?.ambiguous).toBe(false)
})

test('chooses neutralization explicitly and leaves source text intact', () => {
  const workbook = readCsv(encode('name,value\nA,=SUM(1)\nB, -2'))
  const sheet = workbook.sheets[0]
  expect(decode(writeCsv(workbook, { sheetId: sheet.id, safety: 'safe' }))).toBe("name,value\nA,'=SUM(1)\nB,' -2")
  expect(decode(writeCsv(workbook, { sheetId: sheet.id, safety: 'literal' }))).toBe('name,value\nA,=SUM(1)\nB, -2')
})

test('rejects malformed CSV, invalid UTF-8 and missing target sheets', () => {
  expect(() => readCsv(encode('a,"unclosed'), ',')).toThrow(/quote/i)
  expect(() => readCsv(new Uint8Array([255, 254, 10, 0]))).toThrow(/UTF-8/)
  const workbook = readCsv(encode('a'))
  expect(() => writeCsv(workbook, { sheetId: 'missing', safety: 'literal' })).toThrow(/worksheet/i)
})

test('omits styled blanks outside the CSV data and retains explicitly imported empty fields', () => {
  const workbook = readCsv(encode('value,,\r\n'))
  const sheet = workbook.sheets[0]
  sheet.cells.D200000 = { kind: 'text', value: '', style: { bold: true } }
  expect(decode(writeCsv(workbook, { sheetId: sheet.id, safety: 'literal' }))).toBe('value,,\r\n')
})

test('round trips a final empty one-field record without a final line ending', () => {
  for (const source of ['""', 'header\n""']) {
    const workbook = readCsv(encode(source))
    const bytes = writeCsv(workbook, { sheetId: workbook.sheets[0].id, safety: 'literal' })
    expect(decode(bytes)).toBe(source)
    expect(readCsv(bytes).csv?.rowWidths).toEqual(workbook.csv?.rowWidths)
  }
})

test('retains a literal leading zero-width no-break space in a BOM-less CSV', () => {
  const workbook = readCsv(encode('"\ufeffidentifier"'))
  const bytes = writeCsv(workbook, { sheetId: workbook.sheets[0].id, safety: 'literal' })
  expect(readCsv(bytes).sheets[0].cells.A1.value).toBe('\ufeffidentifier')
})

test('neutralizes formula-shaped strings regardless of their source cell type', () => {
  const workbook = readCsv(encode('header\n=SUM(1)\n-20'))
  const sheet = workbook.sheets[0]
  sheet.cells.A2.kind = 'error'
  sheet.cells.A3 = { kind: 'number', value: -20 }
  expect(decode(writeCsv(workbook, { sheetId: sheet.id, safety: 'safe' }))).toBe("header\n'=SUM(1)\n-20")
})

test('retries a plausible delimiter when a quote beyond the detection sample proves it wrong', () => {
  const lines = Array.from({ length: 32 }, (_, index) => 'id' + index + ';Town, State')
  const workbook = readCsv(encode([...lines, 'last;"quoted;value"'].join('\n')))
  expect(workbook.csv?.delimiter).toBe(';')
  expect(workbook.sheets[0].cells.B33.value).toBe('quoted;value')
})
