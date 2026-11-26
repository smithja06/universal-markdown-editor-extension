import { parentPort } from 'node:worker_threads'
import { processDocx } from '../../src/document/formats/docx/codec'
import type { DocxWorkerRequest } from '../../src/document/formats/docx/codecMessages'

parentPort?.once('message', (request: DocxWorkerRequest) => {
  const result = processDocx(request)
  parentPort?.postMessage(result, result.operation === 'write' ? [result.bytes.buffer] : [])
})
