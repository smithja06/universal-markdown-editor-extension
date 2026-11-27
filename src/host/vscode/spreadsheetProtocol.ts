import {
  cellAddress, parseAddress, safeSpreadsheetLink, spreadsheetLimits,
  type CsvDialect, type SpreadsheetFormat, type Workbook,
} from '../../document/formats/spreadsheet/model'
import { isFingerprint, isGeneration, isId, isRecord, isUri } from './recovery'
import { isWorkbookTheme } from '../../document/formats/spreadsheet/themes'

export const spreadsheetSnapshotLimit = 32 * 1024 * 1024
export const spreadsheetPngLimit = 24 * 1024 * 1024

type ExportType = SpreadsheetFormat | 'png'
type SpreadsheetExport = { type: 'spreadsheetExport'; id: number; revision: number; filename: string } &
  ({ format: 'xlsx'; sheetId: string; includeCalculated?: boolean } |
   { format: 'csv'; sheetId: string; safety: 'safe' | 'literal'; delimiter?: CsvDialect['delimiter'] } |
   { format: 'png'; bytes: ArrayBuffer })

export type SpreadsheetClientMessage =
  | { type: 'spreadsheetEdit'; id: number; revision: number; change: { from: number; to: number; text: string } }
  | { type: 'spreadsheetOriginal'; id: number; revision: number }
  | { type: 'spreadsheetCsvDialect'; id: number; revision: number; delimiter: CsvDialect['delimiter'] }
  | SpreadsheetExport
  | { type: 'spreadsheetCancel'; id: number }
  | { type: 'spreadsheetCommand'; command: 'save' | 'undo' | 'redo' | 'revert' }
  | { type: 'spreadsheetCalculation'; allowed: boolean }

export interface SpreadsheetStateMeta {
  revision: number
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  external: boolean
}

export interface SpreadsheetState extends SpreadsheetStateMeta {
  uri: string
  title: string
  format: SpreadsheetFormat
  source?: string
  fingerprint?: string
  failure?: string
  notice?: string
  /** True when native Save writes the workbook in place on this host. */
  nativeSave?: boolean
  /** Changes only when the workbook is loaded from disk, so a native Save keeps the grid session. */
  session?: number
}

export type SpreadsheetHostMessage =
  | { type: 'spreadsheetState'; state: SpreadsheetState; rejected?: { id: number; message: string } }
  | { type: 'spreadsheetAccepted'; id: number; state: SpreadsheetStateMeta }
  | { type: 'spreadsheetFileResult'; id: number; status: 'saved' | 'updated' | 'cancelled' | 'error'; name?: string; message?: string }

const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum
const has = (value: unknown, choices: readonly string[]) => typeof value === 'string' && choices.includes(value)
const bool = (value: unknown) => typeof value === 'boolean'
const optional = (value: unknown, valid: (value: unknown) => boolean) => value === undefined || valid(value)
const delimiter = (value: unknown) => has(value, [',', ';', '\t', '|'])

export function isSpreadsheetFilename(value: unknown, format: ExportType): value is string {
  if (!text(value, 180) || value !== value.trim()) return false
  if (!value.toLowerCase().endsWith('.' + format)) return false
  const stem = value.slice(0, -format.length - 1)
  // Reject controls, path separators, Windows device names and ambiguous trailing spaces or dots.
  // eslint-disable-next-line no-control-regex
  return !!stem && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(value) && !/[. ]$/.test(stem) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:[. ]|$)/i.test(stem)
}

export function isSpreadsheetPng(bytes: ArrayBuffer) {
  if (bytes.byteLength < 33 || bytes.byteLength > spreadsheetPngLimit) return false
  const header = new DataView(bytes)
  if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a ||
    header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) return false
  const width = header.getUint32(16), height = header.getUint32(20)
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 32_000_000
}

export function isSpreadsheetClientMessage(value: unknown): value is SpreadsheetClientMessage {
  if (!isRecord(value)) return false
  if (value.type === 'spreadsheetCommand') return has(value.command, ['save', 'undo', 'redo', 'revert'])
  if (value.type === 'spreadsheetCalculation') return bool(value.allowed)
  if (!isGeneration(value.id)) return false
  if (value.type === 'spreadsheetCancel') return true
  if (!isGeneration(value.revision)) return false
  if (value.type === 'spreadsheetOriginal') return true
  if (value.type === 'spreadsheetCsvDialect') return delimiter(value.delimiter)
  if (value.type === 'spreadsheetEdit') {
    const change = value.change
    return isRecord(change) && integer(change.from, 0, spreadsheetSnapshotLimit) &&
      integer(change.to, change.from, spreadsheetSnapshotLimit) && text(change.text, spreadsheetSnapshotLimit)
  }
  if (value.type !== 'spreadsheetExport') return false
  if (value.format === 'png') return isSpreadsheetFilename(value.filename, 'png') && value.bytes instanceof ArrayBuffer && isSpreadsheetPng(value.bytes)
  if (!isId(value.sheetId)) return false
  if (value.format === 'xlsx') return isSpreadsheetFilename(value.filename, 'xlsx') && optional(value.includeCalculated, bool)
  return value.format === 'csv' && isSpreadsheetFilename(value.filename, 'csv') && has(value.safety, ['safe', 'literal']) &&
    optional(value.delimiter, delimiter)
}

function isMeta(value: unknown): value is SpreadsheetStateMeta {
  return isRecord(value) && isGeneration(value.revision) && bool(value.dirty) && bool(value.canUndo) && bool(value.canRedo) && bool(value.external)
}

export function isSpreadsheetHostMessage(value: unknown): value is SpreadsheetHostMessage {
  if (!isRecord(value)) return false
  if (value.type === 'spreadsheetAccepted') return isGeneration(value.id) && isMeta(value.state)
  if (value.type === 'spreadsheetFileResult') return isGeneration(value.id) && has(value.status, ['saved', 'updated', 'cancelled', 'error']) &&
    optional(value.name, name => text(name, 1024)) && optional(value.message, message => text(message, 1024))
  if (value.type !== 'spreadsheetState') return false
  const state = value.state
  return isRecord(state) && isUri(state.uri) && text(state.title, 1024) && has(state.format, ['xlsx', 'csv']) &&
    optional(state.source, source => text(source, spreadsheetSnapshotLimit)) && optional(state.fingerprint, isFingerprint) &&
    optional(state.failure, failure => text(failure, 1024)) && optional(state.notice, notice => text(notice, 1024)) && isMeta(state) &&
    optional(state.nativeSave, bool) && optional(state.session, isGeneration) &&
    optional(value.rejected, rejected => isRecord(rejected) && isGeneration(rejected.id) && text(rejected.message, 1024))
}

const cellValue = (value: unknown) => bool(value) || text(value, spreadsheetLimits.cellLength) ||
  (typeof value === 'number' && Number.isFinite(value))
const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)
const row = (value: unknown) => integer(value, 1, spreadsheetLimits.rows)
const col = (value: unknown) => integer(value, 1, spreadsheetLimits.cols)

function range(value: unknown) {
  return isRecord(value) && integer(value.row, 1, spreadsheetLimits.rows) && integer(value.col, 1, spreadsheetLimits.cols) &&
    integer(value.endRow, value.row, spreadsheetLimits.rows) && integer(value.endCol, value.col, spreadsheetLimits.cols)
}

function border(value: unknown) {
  return isRecord(value) && color(value.color) && has(value.style, ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double'])
}

function style(value: unknown) {
  if (!isRecord(value)) return false
  return ['bold', 'italic', 'underline', 'strike', 'wrap'].every(key => optional(value[key], bool)) &&
    optional(value.font, name => text(name, 256)) && optional(value.size, size => finite(size, 1, 409)) &&
    optional(value.color, color) && optional(value.fill, color) &&
    optional(value.horizontal, direction => has(direction, ['left', 'center', 'right'])) &&
    optional(value.vertical, direction => has(direction, ['top', 'middle', 'bottom'])) &&
    optional(value.numberFormat, pattern => text(pattern, 1024)) &&
    optional(value.borders, sides => isRecord(sides) && Object.entries(sides).every(([key, side]) =>
      has(key, ['top', 'right', 'bottom', 'left']) && border(side)))
}

function formattedCell(value: unknown) {
  if (!isRecord(value) || !optional(value.cached, cellValue) || !optional(value.cachedError, error => error === true) || !optional(value.style, style) ||
    !optional(value.link, link => typeof link === 'string' && !!safeSpreadsheetLink(link))) return false
  switch (value.kind) {
    case 'number': return typeof value.value === 'number' && Number.isFinite(value.value)
    case 'boolean': return bool(value.value)
    case 'text':
    case 'error': return text(value.value, spreadsheetLimits.cellLength)
    case 'formula': return text(value.value, spreadsheetLimits.cellLength) && value.value.startsWith('=')
    case 'date': return text(value.value, spreadsheetLimits.cellLength) ||
      (typeof value.value === 'number' && Number.isFinite(value.value))
    default: return false
  }
}

function dimensions(value: unknown, axis: 'row' | 'col') {
  return isRecord(value) && Object.entries(value).every(([index, amount]) =>
    /^\d+$/.test(index) && (axis === 'row' ? row(Number(index)) : col(Number(index))) && finite(amount, 0, 8192))
}

function conditionalRule(value: unknown) {
  return isRecord(value) && text(value.id, 128) && range(value.range) &&
    has(value.operator, ['greater', 'less', 'equal', 'between', 'contains', 'duplicate', 'colorScale', 'dataBar']) &&
    optional(value.value, argument => text(argument, spreadsheetLimits.cellLength)) &&
    optional(value.upper, argument => text(argument, spreadsheetLimits.cellLength)) &&
    optional(value.valueType, type => has(type, ['text', 'number'])) &&
    color(value.color) && optional(value.color2, color)
}

function csvDialect(value: unknown) {
  return isRecord(value) && delimiter(value.delimiter) && has(value.lineEnding, ['\r\n', '\n', '\r']) &&
    [value.bom, value.finalNewline, value.header].every(bool) && Array.isArray(value.rowWidths) &&
    value.rowWidths.length <= spreadsheetLimits.rows && value.rowWidths.every(width => integer(width, 0, spreadsheetLimits.cols)) &&
    optional(value.ambiguous, bool) && optional(value.mixedLineEndings, bool)
}

export function readSpreadsheetSnapshot(source: string): Workbook {
  if (source.length > spreadsheetSnapshotLimit) throw new Error('This workbook draft exceeds Folio’s storage limit.')
  const candidate: unknown = JSON.parse(source)
  const invalid = () => new Error('Folio could not validate this workbook draft.')
  if (!isRecord(candidate) || !Array.isArray(candidate.sheets) || !candidate.sheets.length ||
    candidate.sheets.length > spreadsheetLimits.sheets || !text(candidate.locale, 128) || !text(candidate.timezone, 128) ||
    !bool(candidate.date1904) || !bool(candidate.imported) || !Array.isArray(candidate.warnings) ||
    candidate.warnings.length > 256 || !candidate.warnings.every(warning => text(warning, 2048)) ||
    !optional(candidate.csv, csvDialect) || !optional(candidate.theme, isWorkbookTheme)) throw invalid()
  try { new Intl.DateTimeFormat(candidate.locale, { timeZone: candidate.timezone }) }
  catch { throw invalid() }
  const ids = new Set<string>()
  const names = new Set<string>()
  let cells = 0
  for (const sheet of candidate.sheets as unknown[]) {
    if (!isRecord(sheet) || !isId(sheet.id) || ids.has(sheet.id) || !text(sheet.name, 31) || !sheet.name ||
      /[[\]:*?/\\]/.test(sheet.name) || names.has(sheet.name.toLowerCase()) || !isRecord(sheet.cells) ||
      !dimensions(sheet.widths, 'col') || !dimensions(sheet.heights, 'row') || !bool(sheet.gridLines) ||
      !integer(sheet.frozenRows, 0, spreadsheetLimits.rows) || !integer(sheet.frozenCols, 0, spreadsheetLimits.cols) ||
      !Array.isArray(sheet.merges) || sheet.merges.length > spreadsheetLimits.cells || !sheet.merges.every(range) ||
      !Array.isArray(sheet.rules) || sheet.rules.length > 4096 || !sheet.rules.every(conditionalRule) ||
      !optional(sheet.hiddenRows, values => Array.isArray(values) && values.length <= spreadsheetLimits.rows && values.every(row)) ||
      !optional(sheet.hiddenCols, values => Array.isArray(values) && values.length <= spreadsheetLimits.cols && values.every(col)) ||
      !optional(sheet.rowCount, count => integer(count, 0, spreadsheetLimits.rows)) ||
      !optional(sheet.colCount, count => integer(count, 0, spreadsheetLimits.cols))) throw invalid()
    ids.add(sheet.id)
    names.add(sheet.name.toLowerCase())
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const point = parseAddress(address)
      if (!point || address !== cellAddress(point.row, point.col) || !formattedCell(cell) || ++cells > spreadsheetLimits.cells) throw invalid()
    }
  }
  return candidate as unknown as Workbook
}
