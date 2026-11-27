import { initSync } from '@ironcalc/wasm-xlsx'
import { runCalculation, workbookWithCalculatedCaches } from './calculation'
import { exportXlsx } from './xlsxExport'
import { importXlsx } from './xlsxImport'
import { restructureFormulas } from './restructure'
import type { SpreadsheetReply, SpreadsheetRequest } from './xlsxMessages'

export type { SpreadsheetReply, SpreadsheetRequest } from './xlsxMessages'

/** Run inside a disposable, time-bounded worker. Instantiation takes local bytes. */
export function processSpreadsheet<Request extends SpreadsheetRequest>(request: Request, wasmBytes: Uint8Array<ArrayBuffer>): Extract<SpreadsheetReply, { operation: Request['operation'] | 'error' }>
export function processSpreadsheet(request: SpreadsheetRequest, wasmBytes: Uint8Array<ArrayBuffer>): SpreadsheetReply {
  try {
    initSync({ module: wasmBytes })
    switch (request.operation) {
      case 'read': return { operation: 'read', workbook: importXlsx(request.bytes) }
      case 'write': return { operation: 'write', bytes: exportXlsx(
        request.includeCalculated ? workbookWithCalculatedCaches(request.workbook) : request.workbook) }
      case 'calculate': return { operation: 'calculate', results: runCalculation(request.workbook) }
      case 'restructure': return { operation: 'restructure', updates: restructureFormulas(request.workbook, request.change) }
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'RuntimeError' ? 'IronCalc could not process this workbook safely.'
      : error instanceof Error ? error.message : 'IronCalc could not process this workbook.'
    return { operation: 'error', message: message.slice(0, 500) }
  }
}
