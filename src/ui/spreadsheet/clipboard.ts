import { spreadsheetLimits, type Cell } from '../../document/formats/spreadsheet/model'

export const typedClipboardMime = 'application/x-folio-spreadsheet-cells+json'
export const clipboardCharacterLimit = 2_000_000
type ClipboardCell = Pick<Cell, 'kind' | 'value'>

export function encodeTypedClipboard(rows: (Cell | undefined)[][], date1904: boolean) {
  return JSON.stringify({ date1904, rows: rows.map(row => row.map(cell => cell ? { kind: cell.kind, value: cell.value } : null)) })
}

function record(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input)
}

function decodeCell(input: unknown, from1904: boolean, to1904: boolean): ClipboardCell | null | undefined {
  if (input === null) return null
  if (!record(input)) return
  const { kind, value } = input
  if (kind === 'boolean' && typeof value === 'boolean') return { kind, value }
  if (kind === 'number' && typeof value === 'number' && Number.isFinite(value)) return { kind, value }
  if (kind === 'date' && typeof value === 'number' && Number.isFinite(value)) {
    if (from1904 === to1904) return { kind, value }
    if (!from1904 && Math.floor(value) === 60) return { kind: 'text', value: '1900-02-29' }
    const converted = from1904 ? value + (value + 1461 >= 60 ? 1462 : 1461) : value - (value >= 60 ? 1462 : 1461)
    return { kind, value: converted }
  }
  if (typeof value !== 'string' || value.length > spreadsheetLimits.cellLength || /[\uD800-\uDFFF]/u.test(value)) return
  if (kind === 'text' || kind === 'error' || kind === 'date') return { kind, value }
  if (kind === 'formula' && value.startsWith('=') && value.length > 1) return { kind, value }
}

export function decodeTypedClipboard(raw: string, date1904: boolean): (ClipboardCell | undefined)[][] | undefined {
  if (!raw || raw.length > clipboardCharacterLimit) return
  let packet: unknown
  try { packet = JSON.parse(raw) } catch { return }
  if (!record(packet) || typeof packet.date1904 !== 'boolean' || !Array.isArray(packet.rows) || !packet.rows.length) return
  const first: unknown = packet.rows[0]
  if (!Array.isArray(first) || !first.length || first.length > spreadsheetLimits.cols ||
    first.length * packet.rows.length > spreadsheetLimits.rangeCells) return
  const rows: (ClipboardCell | undefined)[][] = []
  for (const row of packet.rows as unknown[]) {
    if (!Array.isArray(row) || row.length !== first.length) return
    const cells: (ClipboardCell | undefined)[] = []
    for (const item of row as unknown[]) {
      const cell = decodeCell(item, packet.date1904, date1904)
      if (cell === undefined) return
      cells.push(cell ?? undefined)
    }
    rows.push(cells)
  }
  return rows
}
