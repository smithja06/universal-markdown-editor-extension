import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { readCsv, writeCsv } from '../../src/document/formats/spreadsheet/csv'
import { processSpreadsheet } from '../../src/document/formats/spreadsheet/xlsx'
import type { Request, Reply } from './spreadsheetWorker'

parentPort?.once('message', (request: Request) => {
  let result: Reply
  try {
    switch (request.operation) {
      case 'readCsv': result = { operation: 'readCsv', workbook: readCsv(request.bytes, request.delimiter) }; break
      case 'writeCsv': result = { operation: 'writeCsv', bytes: writeCsv(request.workbook, request.options) }; break
      default: {
        const wasm = Uint8Array.from(readFileSync(join(__dirname, 'spreadsheet.wasm')))
        result = processSpreadsheet(request, wasm)
      }
    }
  } catch (error) {
    result = { operation: 'error', message: error instanceof Error ? error.message.slice(0, 1024) : 'The workbook codec failed.' }
  }
  parentPort?.postMessage(result, 'bytes' in result ? [result.bytes.buffer] : [])
})
