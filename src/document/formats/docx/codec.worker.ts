import { processDocx } from './codec'
import type { DocxWorkerRequest } from './codecMessages'

self.onmessage = ({ data }: MessageEvent<DocxWorkerRequest>) => {
  const result = processDocx(data)
  self.postMessage(result, { transfer: result.operation === 'write' ? [result.bytes.buffer] : [] })
}
