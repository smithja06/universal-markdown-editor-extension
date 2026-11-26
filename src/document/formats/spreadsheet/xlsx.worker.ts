import asset from '../../../../node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm?url&inline'
import { processSpreadsheet, type SpreadsheetRequest } from './xlsx'

self.onmessage = ({ data }: MessageEvent<SpreadsheetRequest>) => {
  const reply = processSpreadsheet(data, Uint8Array.from(atob(asset.slice(asset.indexOf(',') + 1)), char => char.charCodeAt(0)))
  self.postMessage(reply, { transfer: reply.operation === 'write' ? [reply.bytes.buffer] : [] })
}
