import { getTokens, type MarkedToken } from '@ironcalc/wasm-xlsx'
import { cellAddress, parseAddress, spreadsheetLimits, type Workbook } from './model'
import { createEngine } from './xlsxExport'

/** A structural edit whose formula references IronCalc updates from its parsed formulas. */
export type StructureChange =
  | { kind: 'insert' | 'delete'; sheetId: string; axis: 'row' | 'col'; index: number }
  | { kind: 'rename'; sheetId: string; name: string }

/** Updated formula text by sheet ID and the cell's address after the change. Only formulas whose references change appear. */
export type FormulaUpdates = Record<string, Record<string, string>>

const formulaLimit = 20_000

export class StructureRefusal extends Error {}

const kind = (token: MarkedToken['token']) => typeof token === 'string' ? token : Object.keys(token)[0]
const referenceKinds = new Set(['Reference', 'Range'])

/** Reasons a formula's references cannot be updated by parsing it, or undefined when it is safe. */
export function structureRefusal(formula: string) {
  const outside = formula.replace(/"(?:[^"]|"")*"/g, '""')
  if (/\b(?:INDIRECT|OFFSET)\s*\(/i.test(outside)) return 'uses INDIRECT or OFFSET, whose text references cannot be updated'
  if (/\[/.test(outside)) return 'uses an external or structured table reference'
  const tokens = getTokens(formula.slice(1))
  if (tokens.some(token => kind(token.token) === 'Illegal')) return 'contains text IronCalc cannot parse'
}

/** Token positions IronCalc changed between two serializations of the same formula. Only references may change. */
export function changedReferences(before: string, after: string) {
  const left = getTokens(before.slice(1))
  const right = getTokens(after.slice(1))
  if (left.length !== right.length) throw new StructureRefusal('IronCalc changed the formula structure.')
  const changes = new Map<number, string>()
  left.forEach((token, index) => {
    const other = right[index]
    const leftKind = kind(token.token), rightKind = kind(other.token)
    const leftText = before.slice(1).slice(token.start, token.end)
    const rightText = after.slice(1).slice(other.start, other.end)
    if (referenceKinds.has(leftKind)) {
      if (!referenceKinds.has(rightKind) && !(rightKind === 'Error' && rightText === '#REF!')) {
        throw new StructureRefusal('IronCalc changed a reference into another token.')
      }
      if (leftText.trim() !== rightText.trim()) changes.set(index, rightText.trim())
    } else if (leftKind !== rightKind || leftText.toUpperCase() !== rightText.toUpperCase()) {
      throw new StructureRefusal('IronCalc changed a formula token other than a reference.')
    }
  })
  return changes
}

/**
 * Writes changed references into the user's formula text. Its tokens must align with IronCalc's serialization, so
 * spacing, function-name case, literals and untouched references stay exactly as written.
 */
export function applyReferences(original: string, serialized: string, changes: Map<number, string>) {
  const tokens = getTokens(original.slice(1))
  const reference = getTokens(serialized.slice(1))
  if (tokens.length !== reference.length || tokens.some((token, index) => kind(token.token) !== kind(reference[index].token))) {
    throw new StructureRefusal('Folio could not align this formula with IronCalc.')
  }
  let output = original.slice(1)
  for (const index of [...changes.keys()].sort((a, b) => b - a)) {
    const { start, end } = tokens[index]
    // Token spans include surrounding whitespace, which stays as the user wrote it.
    const [, lead, , trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(output.slice(start, end))!
    output = output.slice(0, start) + lead + changes.get(index) + trail + output.slice(end)
  }
  return '=' + output
}

function moved(change: StructureChange, address: string) {
  if (change.kind === 'rename') return address
  const point = parseAddress(address)
  if (!point) return
  const at = change.index
  const value = point[change.axis]
  const next = value < at ? value : value === at && change.kind === 'delete' ? undefined : value + (change.kind === 'insert' ? 1 : -1)
  const limit = change.axis === 'row' ? spreadsheetLimits.rows : spreadsheetLimits.cols
  if (!next || next > limit) return
  point[change.axis] = next
  return cellAddress(point.row, point.col)
}

/** Runs the change in IronCalc and returns the reference updates for every formula in the workbook. */
export function restructureFormulas(workbook: Workbook, change: StructureChange): FormulaUpdates {
  const target = workbook.sheets.findIndex(sheet => sheet.id === change.sheetId)
  if (target < 0) throw new StructureRefusal('The worksheet is unavailable.')
  const formulas: { sheet: number; address: string; row: number; col: number; value: string }[] = []
  workbook.sheets.forEach((sheet, index) => {
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.kind !== 'formula') continue
      const point = parseAddress(address)
      const value = String(cell.value)
      if (!point || !value.startsWith('=')) continue
      const reason = structureRefusal(value)
      if (reason) throw new StructureRefusal(`${sheet.name}!${address} ${reason}.`)
      if (formulas.push({ sheet: index, address, row: point.row, col: point.col, value }) > formulaLimit) {
        throw new StructureRefusal('Folio updates references for up to 20,000 formulas at a time.')
      }
    }
  })
  const updates: FormulaUpdates = {}
  if (!formulas.length) return updates
  const model = createEngine(workbook, workbook.timezone)
  try {
    model.pauseEvaluation()
    for (const formula of formulas) model.setUserInput(formula.sheet, formula.row, formula.col, formula.value)
    const baseline = formulas.map(formula => model.getCellContent(formula.sheet, formula.row, formula.col))
    if (change.kind === 'rename') model.renameSheet(target, change.name)
    else if (change.axis === 'row') (change.kind === 'insert' ? model.insertRows : model.deleteRows).call(model, target, change.index, 1)
    else (change.kind === 'insert' ? model.insertColumns : model.deleteColumns).call(model, target, change.index, 1)
    formulas.forEach((formula, index) => {
      const address = formula.sheet === target ? moved(change, formula.address) : formula.address
      if (!address) return
      const point = parseAddress(address)!
      const after = model.getCellContent(formula.sheet, point.row, point.col)
      if (after === baseline[index]) return
      // Compare IronCalc's own text before and after, then carry only the reference changes into the user's text.
      const text = applyReferences(formula.value, baseline[index], changedReferences(baseline[index], after))
      if (text === formula.value) return
      const sheetId = workbook.sheets[formula.sheet].id
      ;(updates[sheetId] ??= {})[address] = text
    })
    return updates
  } finally { model.free() }
}
