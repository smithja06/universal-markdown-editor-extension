import CsvWorker from './csv.worker?worker&inline'
import type { CsvExportOptions } from './csv'
import type { CsvDialect, Workbook } from './model'

export type CsvRequest = { operation: 'read'; bytes: Uint8Array<ArrayBuffer>; delimiter?: CsvDialect['delimiter'] }
  | { operation: 'write'; workbook: Workbook; options: CsvExportOptions }
export type CsvReply = { operation: 'read'; workbook: Workbook }
  | { operation: 'write'; bytes: Uint8Array<ArrayBuffer> }
  | { operation: 'error'; message: string }

async function requestCsv(request: CsvRequest, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const worker = new CsvWorker()
  let abort: (() => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<CsvReply>((resolve, reject) => {
      abort = () => reject(signal?.reason instanceof Error ? signal.reason : new DOMException('CSV processing stopped.', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      timeout = setTimeout(() => reject(new Error('CSV processing exceeded its time limit.')), 15_000)
      worker.onmessage = (event: MessageEvent<CsvReply>) => resolve(event.data)
      worker.onerror = () => reject(new Error('The CSV worker could not run.'))
      worker.onmessageerror = () => reject(new Error('The CSV worker returned an unreadable result.'))
      worker.postMessage(request, request.operation === 'read' ? [request.bytes.buffer] : [])
    })
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    clearTimeout(timeout)
    worker.terminate()
  }
}

export async function readCsvInWorker(bytes: Uint8Array<ArrayBuffer>, delimiter?: CsvDialect['delimiter'], signal?: AbortSignal) {
  const result = await requestCsv({ operation: 'read', bytes, delimiter }, signal)
  if (result.operation === 'error') throw new Error(result.message)
  if (result.operation !== 'read') throw new Error('The CSV import result did not match the request.')
  return result.workbook
}

export async function writeCsvInWorker(workbook: Workbook, options: CsvExportOptions, signal?: AbortSignal) {
  const result = await requestCsv({ operation: 'write', workbook, options }, signal)
  if (result.operation === 'error') throw new Error(result.message)
  if (result.operation !== 'write') throw new Error('The CSV export result did not match the request.')
  return result.bytes
}
