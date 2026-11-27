import SpreadsheetWorker from './xlsx.worker?worker&inline'
import type { Workbook } from './model'
import type { SpreadsheetReply, SpreadsheetRequest } from './xlsxMessages'
import type { StructureChange } from './restructure'

let running = 0

async function requestWorkbook<Request extends SpreadsheetRequest>(request: Request, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (running >= 3) throw new Error('Folio is already processing several spreadsheets. Try again shortly.')
  const worker = new SpreadsheetWorker()
  running++
  let abort: () => void = () => undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise<SpreadsheetReply>((resolve, reject) => {
      abort = () => reject(new DOMException('Spreadsheet processing was cancelled.', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      timeout = setTimeout(() => reject(new Error('Spreadsheet processing exceeded its time limit.')), request.operation === 'calculate' || request.operation === 'restructure' ? 12_000 : 25_000)
      worker.onmessage = (event: MessageEvent<SpreadsheetReply>) => resolve(event.data)
      worker.onerror = () => reject(new Error('The spreadsheet worker stopped unexpectedly.'))
      worker.onmessageerror = () => reject(new Error('The spreadsheet worker returned an unreadable result.'))
      worker.postMessage(request, request.operation === 'read' ? [request.bytes.buffer] : [])
    })
    signal?.throwIfAborted()
    if (result.operation === 'error') throw new Error(result.message)
    if (result.operation !== request.operation) throw new Error('The spreadsheet worker returned an unexpected result.')
    return result as Extract<SpreadsheetReply, { operation: Request['operation'] }>
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    worker.terminate()
    running--
  }
}

export async function readXlsx(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
  return (await requestWorkbook({ operation: 'read', bytes: bytes.slice() }, signal)).workbook
}

export async function writeXlsx(workbook: Workbook, signal?: AbortSignal, includeCalculated = false) {
  return (await requestWorkbook({ operation: 'write', workbook, includeCalculated }, signal)).bytes
}

/** Formula reference updates for a structural edit, computed by IronCalc in the isolated worker. */
export async function restructureWorkbook(workbook: Workbook, change: StructureChange, signal?: AbortSignal) {
  return (await requestWorkbook({ operation: 'restructure', workbook, change }, signal)).updates
}

export async function calculateWorkbook(workbook: Workbook, signal?: AbortSignal) {
  return (await requestWorkbook({ operation: 'calculate', workbook }, signal)).results
}
