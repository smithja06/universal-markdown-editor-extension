import type { JSONContent } from '@tiptap/core'
import type { DocxWorkerReply, DocxWorkerRequest } from './codecMessages'

function requestDocx(request: DocxWorkerRequest, signal?: AbortSignal): Promise<DocxWorkerReply> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module' })
  let abort: (() => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  return new Promise<DocxWorkerReply>((resolve, reject) => {
    abort = () => {
      const reason: unknown = signal?.reason
      reject(reason instanceof Error ? reason : new DOMException('DOCX processing stopped.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    timeout = setTimeout(() => reject(new Error('DOCX processing exceeded its time limit.')), 25_000)
    worker.onmessage = (event: MessageEvent<DocxWorkerReply>) => resolve(event.data)
    worker.onerror = () => reject(new Error('The DOCX codec could not run.'))
    worker.onmessageerror = () => reject(new Error('The DOCX codec returned an unreadable result.'))
    worker.postMessage(request, request.operation === 'read' ? [request.bytes.buffer] : [])
  }).finally(() => {
    if (abort) signal?.removeEventListener('abort', abort)
    clearTimeout(timeout)
    worker.terminate()
  })
}

export async function readDocxInWorker(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
  const result = await requestDocx({ operation: 'read', bytes: bytes.slice() }, signal)
  if (result.operation === 'error') throw new Error(result.message)
  if (result.operation !== 'read') throw new Error('The DOCX import result did not match the request.')
  return result
}

export async function writeDocxInWorker(document: JSONContent, signal?: AbortSignal) {
  const result = await requestDocx({ operation: 'write', document }, signal)
  if (result.operation === 'error') throw new Error(result.message)
  if (result.operation !== 'write') throw new Error('The DOCX export result did not match the request.')
  return result.bytes
}
