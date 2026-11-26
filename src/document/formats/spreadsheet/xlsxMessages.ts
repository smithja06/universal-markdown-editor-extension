import type { CellValue, Workbook } from './model'

export type CalculationResults = Record<string, Record<string, CellValue>>
export type SpreadsheetRequest =
  | { operation: 'read'; bytes: Uint8Array<ArrayBuffer> }
  | { operation: 'write'; workbook: Workbook; includeCalculated?: boolean }
  | { operation: 'calculate'; workbook: Workbook }

export type SpreadsheetReply =
  | { operation: 'read'; workbook: Workbook }
  | { operation: 'write'; bytes: Uint8Array<ArrayBuffer> }
  | { operation: 'calculate'; results: CalculationResults }
  | { operation: 'error'; message: string }
