import type { CellValue, Workbook } from './model'
import type { FormulaUpdates, StructureChange } from './restructure'

export type CalculationResults = Record<string, Record<string, CellValue>>
export type SpreadsheetRequest =
  | { operation: 'read'; bytes: Uint8Array<ArrayBuffer> }
  | { operation: 'write'; workbook: Workbook; includeCalculated?: boolean }
  | { operation: 'calculate'; workbook: Workbook }
  | { operation: 'restructure'; workbook: Workbook; change: StructureChange }

export type SpreadsheetReply =
  | { operation: 'read'; workbook: Workbook }
  | { operation: 'write'; bytes: Uint8Array<ArrayBuffer> }
  | { operation: 'calculate'; results: CalculationResults }
  | { operation: 'restructure'; updates: FormulaUpdates }
  | { operation: 'error'; message: string }
