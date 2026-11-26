import { getTokens } from '@ironcalc/wasm-xlsx'
import { unzipSync } from 'fflate'
import { cellAddress, parseAddress, type CellValue, type Workbook } from './model'
import { createEngine, setLiteral, validateWorkbook } from './xlsxExport'
import type { CalculationResults } from './xlsxMessages'
import { child, children, xmlReader } from './xlsxXml'
import { catalogFunction, formulaCatalog } from './formulaCatalog'

type Formula = { address: string; sheet: number; value: string; dependencies: number[]; supported: boolean }
const allowedFunctions = new Set<string>(formulaCatalog.map(entry => entry.name))
const punctuation = new Set(['LeftParenthesis', 'RightParenthesis', 'Comma', 'Power', 'Percent', 'And', 'EOF'])
const formulaLimit = 2_000
const referenceLimit = 250_000
const dependencyDepthLimit = 96
const knownErrors = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'])
const dayMs = 86_400_000

function serialDate(value: string, date1904: boolean) {
  const timestamp = Date.parse(/T/i.test(value) && !/(?:z|[+-]\d{2}:\d{2})$/i.test(value) ? value + 'Z' : value)
  if (!Number.isFinite(timestamp)) return undefined
  if (date1904) return (timestamp - Date.UTC(1904, 0, 1)) / dayMs
  return (timestamp - Date.UTC(1899, 11, 31)) / dayMs + Number(timestamp >= Date.UTC(1900, 2, 1))
}

function inspectFormula(formula: Formula, names: Map<string, number>, lookup: Map<string, number>[], workbook: Workbook, budget: { references: number }) {
  if (!formula.value.startsWith('=') || formula.value.length > 1024) return false
  const tokens = getTokens(formula.value.slice(1))
  if (tokens.length > 128) return false
  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index].token
    if (typeof value === 'string') {
      if (!punctuation.has(value)) return false
      continue
    }
    if ('Ident' in value) {
      const name = value.Ident.toUpperCase()
      if (!allowedFunctions.has(name) || tokens[index + 1]?.token !== 'LeftParenthesis' || workbook.date1904 && catalogFunction(name)?.date1900) return false
    } else if ('Reference' in value || 'Range' in value) {
      const range = 'Range' in value ? value.Range : { sheet: value.Reference.sheet, left: value.Reference, right: value.Reference }
      const sheet = range.sheet ? names.get(range.sheet.toLowerCase()) : formula.sheet
      if (sheet === undefined) return false
      const rowStart = Math.min(range.left.row, range.right.row)
      const rowEnd = Math.max(range.left.row, range.right.row)
      const colStart = Math.min(range.left.column, range.right.column)
      const colEnd = Math.max(range.left.column, range.right.column)
      const area = (rowEnd - rowStart + 1) * (colEnd - colStart + 1)
      if (area > 20_000 || rowStart < 1 || colStart < 1) return false
      budget.references += area
      if (budget.references > referenceLimit) throw new Error('Calculation exceeds the total referenced-cell limit.')
      for (let row = rowStart; row <= rowEnd; row++) for (let col = colStart; col <= colEnd; col++) {
        const reference = lookup[sheet].get(cellAddress(row, col))
        if (reference !== undefined) formula.dependencies.push(reference)
      }
    } else if (!Object.keys(value).some(key => ['String', 'Boolean', 'Number', 'Error', 'Compare', 'Sum', 'Product', 'Addition', 'Multiplication'].includes(key))) {
      return false
    }
  }
  return true
}

function approvedFormulas(formulas: Formula[]) {
  const remaining = formulas.map(formula => formula.dependencies.length)
  const dependents = formulas.map((): number[] => [])
  formulas.forEach((formula, index) => formula.dependencies.forEach(dependency => dependents[dependency].push(index)))
  const approved = new Set<number>()
  const depth = formulas.map(() => 0)
  const queue = remaining.flatMap((count, index) => count === 0 ? [index] : [])
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor]
    if (!formulas[index].supported || depth[index] >= dependencyDepthLimit) continue
    approved.add(index)
    for (const dependent of dependents[index]) {
      depth[dependent] = Math.max(depth[dependent], depth[index] + 1)
      if (--remaining[dependent] === 0) queue.push(dependent)
    }
  }
  return approved
}

function valueFromCache(type: string | undefined, raw: string): CellValue {
  if (!type || type === 'n') return raw === '' ? '#VALUE!' : Number(raw)
  if (type === 'b') return raw === '1'
  return raw
}

export function runCalculation(workbook: Workbook,
  capture?: (sheetId: string, address: string, value: CellValue, error: boolean) => void): CalculationResults {
  validateWorkbook(workbook)
  const output: CalculationResults = {}
  const formulas: Formula[] = []
  const names = new Map<string, number>()
  const byAddress = workbook.sheets.map((sheet, index) => {
    output[sheet.id] = {}
    names.set(sheet.name.toLowerCase(), index)
    const lookup = new Map<string, number>()
    for (const [address, cell] of Object.entries(sheet.cells)) if (cell.kind === 'formula') {
      if (formulas.length >= formulaLimit) throw new Error('Calculation supports up to 2,000 formulas at a time.')
      lookup.set(address, formulas.length)
      formulas.push({ address, sheet: index, value: String(cell.value), dependencies: [], supported: false })
    }
    return lookup
  })
  if (!formulas.length) return output
  const budget = { references: 0 }
  for (const formula of formulas) formula.supported = inspectFormula(formula, names, byAddress, workbook, budget)
  const approved = approvedFormulas(formulas)
  const model = createEngine(workbook, workbook.timezone)
  try {
    workbook.sheets.forEach((sheet, index) => {
      for (const [address, cell] of Object.entries(sheet.cells)) {
        if (cell.kind === 'formula') continue
        const { row, col } = parseAddress(address)!
        if (cell.kind === 'error') model.setUserInput(index, row, col, '=' + (knownErrors.has(String(cell.value)) ? cell.value : '#N/A'))
        else if (cell.kind === 'date' && typeof cell.value === 'string') {
          const serial = serialDate(cell.value, workbook.date1904)
          model.setUserInput(index, row, col, serial === undefined ? '=#VALUE!' : String(serial))
        }
        else setLiteral(model, index, row, col, cell)
      }
    })
    formulas.forEach((formula, index) => {
      const { row, col } = parseAddress(formula.address)!
      if (approved.has(index)) model.setUserInput(formula.sheet, row, col, formula.value)
      else output[workbook.sheets[formula.sheet].id][formula.address] = '#UNSUPPORTED!'
    })
    // The engine's display accessor rounds numeric caches. Read the writer's
    // exact typed result instead, with no workbook formatting in this model.
    model.evaluate()
    const archive = unzipSync(model.toXlsx())
    const parse = xmlReader()
    workbook.sheets.forEach((sheet, index) => {
      const root = parse(archive[`xl/worksheets/sheet${index + 1}.xml`])
      for (const row of children(child(root, 'sheetData'), 'row')) for (const cell of children(row, 'c')) {
        const id = byAddress[index].get(cell.attrs.r)
        if (id !== undefined && approved.has(id)) {
          const value = valueFromCache(cell.attrs.t, child(cell, 'v')?.text ?? '')
          output[sheet.id][cell.attrs.r] = value
          capture?.(sheet.id, cell.attrs.r, value, cell.attrs.t === 'e')
        }
      }
    })
    return output
  } finally { model.free() }
}

export function workbookWithCalculatedCaches(workbook: Workbook): Workbook {
  const patched = new Map<string, Record<string, { cached: CellValue; cachedError?: true }>>()
  runCalculation(workbook, (sheetId, address, cached, error) => {
    const cells = patched.get(sheetId) ?? {}
    cells[address] = { cached, cachedError: error ? true : undefined }
    patched.set(sheetId, cells)
  })
  return { ...workbook, sheets: workbook.sheets.map(sheet => {
    const updates = patched.get(sheet.id)
    if (!updates) return sheet
    const cells = { ...sheet.cells }
    for (const [address, cache] of Object.entries(updates)) cells[address] = { ...cells[address], ...cache }
    return { ...sheet, cells }
  }) }
}
