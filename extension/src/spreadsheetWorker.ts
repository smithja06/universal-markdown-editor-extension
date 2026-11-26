import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { writeCsv } from '../../src/document/formats/spreadsheet/csv'
import type { CsvDialect, Workbook } from '../../src/document/formats/spreadsheet/model'

type Reading = ({ operation: 'read' } | { operation: 'readCsv'; delimiter?: CsvDialect['delimiter'] }) & { bytes: Uint8Array<ArrayBuffer> }
type Writing = { operation: 'write'; workbook: Workbook; includeCalculated?: boolean } |
  { operation: 'writeCsv'; workbook: Workbook; options: Parameters<typeof writeCsv>[1] }
export type Request = Reading | Writing
export type Reply =
  | { operation: 'read' | 'readCsv'; workbook: Workbook }
  | { operation: 'write' | 'writeCsv'; bytes: Uint8Array<ArrayBuffer> }
  | { operation: 'error'; message: string }

let active = 0

type Success = Exclude<Reply, { operation: 'error' }>

export function runSpreadsheetWorker(request: Reading, signal: AbortSignal): Promise<Extract<Success, { workbook: Workbook }>>
export function runSpreadsheetWorker(request: Writing, signal: AbortSignal): Promise<Extract<Success, { bytes: Uint8Array<ArrayBuffer> }>>
export async function runSpreadsheetWorker(request: Request, signal: AbortSignal): Promise<Success> {
  signal.throwIfAborted()
  if (active >= 3) throw new Error('Folio is processing several workbooks. Try again shortly.')
  const worker = new Worker(join(__dirname, 'spreadsheet-codec.cjs'), { resourceLimits: { maxOldGenerationSizeMb: 192 } })
  active++
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => undefined
  try {
    const reply = await new Promise<Reply>((resolve, reject) => {
      abort = () => reject(new Error('Workbook processing was cancelled.', { cause: signal.reason }))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      timeout = setTimeout(() => reject(new Error('Workbook processing exceeded its time limit.')), 25_000)
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', () => reject(new Error('The Folio workbook codec stopped before returning a result.')))
      worker.postMessage(request)
    })
    signal.throwIfAborted()
    if (reply.operation === 'error') throw new Error(reply.message)
    if (reply.operation !== request.operation) throw new Error('The Folio workbook codec returned an unexpected result.')
    return reply
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    try { await worker.terminate() } finally { active-- }
  }
}
