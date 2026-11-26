import { readCsv, writeCsv } from './csv'
import type { CsvRequest, CsvReply } from './csvWorker'

self.onmessage = ({ data }: MessageEvent<CsvRequest>) => {
  let reply: CsvReply
  try {
    reply = data.operation === 'read'
      ? { operation: 'read', workbook: readCsv(data.bytes, data.delimiter) }
      : { operation: 'write', bytes: writeCsv(data.workbook, data.options) }
  } catch (error) {
    reply = { operation: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(reply, { transfer: reply.operation === 'write' ? [reply.bytes.buffer] : [] })
}
