import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { DocxWorkerReply, DocxWorkerRequest } from '../../src/document/formats/docx/codecMessages'

let running = 0

export async function runDocxWorker<Request extends DocxWorkerRequest>(request: Request, signal: AbortSignal) {
  signal.throwIfAborted()
  if (running >= 4) throw new Error('Folio is processing several DOCX files. Try again shortly.')
  const worker = new Worker(join(__dirname, 'docx-codec.cjs'), { resourceLimits: { maxOldGenerationSizeMb: 192 } })
  running++
  let abort: () => void = () => undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise<DocxWorkerReply>((resolve, reject) => {
      abort = () => reject(new Error('DOCX processing was cancelled.', { cause: signal.reason }))
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => reject(new Error('DOCX processing exceeded its time limit.')), 25_000)
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', () => reject(new Error('The Folio DOCX codec stopped before returning a result.')))
      worker.postMessage(request)
    })
    signal.throwIfAborted()
    if (result.operation === 'error') throw new Error(result.message)
    if (result.operation !== request.operation) throw new Error('The Folio DOCX codec returned an unexpected result.')
    return result as Extract<DocxWorkerReply, { operation: Request['operation'] }>
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    try { await worker.terminate() } finally { running-- }
  }
}
