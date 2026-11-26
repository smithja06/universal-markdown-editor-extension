import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowDownToLine, Check, ChevronDown, CircleAlert, FileSpreadsheet, Globe2, HelpCircle, List, LoaderCircle, Plus, Sigma, X } from 'lucide-react'
import { applyEditorText, cellAddress, cellInput, createSheet, editorText, enterCell, normalizeRange, parseAddress, parseRange, rangeAddress, rangeSize,
  spreadsheetLimits, type Border, type Cell, type CellStyle, type CellValue, type CsvDialect, type Point, type Range, type Sheet,
  type SpreadsheetFormat, type Workbook } from '../../document/formats/spreadsheet/model'
import { IconButton, Menu, Modal, type Item } from '../controls'
import { axisMetrics, contains, defaultHeight, defaultWidth, intersects, rewriteSheetReferences, shiftCsvRows, shiftSheet } from './display'
import { clipboardCharacterLimit, decodeTypedClipboard, encodeTypedClipboard, typedClipboardMime } from './clipboard'
import { SpreadsheetGrid, type GridEditing } from './Grid'
import { SpreadsheetToolbar, type BorderMode, type ToolDialog } from './Toolbar'
import { BorderDialog, ColorDialog, ConditionalDialog, ConfirmDialog, DialectDialog, ExportDialog, FormulaReference, InputDialog, LinkDialog,
  NumberDialog, RegionalDialog, WorkbookFind, type SpreadsheetExportRequest } from './dialogs'
import './spreadsheet.css'

export type { SpreadsheetExportRequest } from './dialogs'

interface Props {
  workbook: Workbook
  format: SpreadsheetFormat
  title: string
  onChange: (workbook: Workbook) => void
  readOnly?: boolean
  status?: string
  onSave?: () => void
  saveLabel?: string
  onOriginal?: () => void
  onExport: (request: SpreadsheetExportRequest) => Promise<void>
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  onCsvDialect?: (delimiter: CsvDialect['delimiter']) => Promise<void>
}

const initialPoint = { row: 1, col: 1 }
const defaultBorder: Border = { color: '#40564a', style: 'thin' }
const historyLimit = 30
type Calculation = Record<string, Record<string, CellValue>>
type Axis = 'row' | 'col'
type Dialog = ToolDialog | 'reference' | 'regional' | 'find' | 'rename' | 'delete' | 'merge' | 'dialect' | 'warnings' | 'calculation' | 'resize'
type Direction = NonNullable<Parameters<React.ComponentProps<typeof SpreadsheetGrid>['onCommit']>[0]>
type Selection = { anchor: Point; end: Point }
type ExportState = { target: SpreadsheetFormat | 'png'; workbook: Workbook; sheet: Sheet; range: Range; calculation?: Record<string, CellValue>; includeCalculated?: boolean }

function valueWithoutFormatting(cell: Cell | undefined, value: Cell | undefined): Cell | undefined {
  if (!value && !cell?.style && !cell?.link) return
  return { ...(value ?? { kind: 'text', value: '' }), ...(cell?.style ? { style: cell.style } : {}), ...(cell?.link ? { link: cell.link } : {}) }
}

function patchSheet(workbook: Workbook, sheet: Sheet): Workbook {
  return { ...workbook, sheets: workbook.sheets.map(item => item.id === sheet.id ? sheet : item) }
}

function bounding(sheet: Sheet) {
  let row = sheet.rowCount ?? 1
  let col = sheet.colCount ?? 1
  for (const address in sheet.cells) {
    const point = parseAddress(address)
    if (point) { row = Math.max(row, point.row); col = Math.max(col, point.col) }
  }
  for (const merge of sheet.merges) {
    row = Math.max(row, merge.endRow)
    col = Math.max(col, merge.endCol)
  }
  return { row, col }
}

function workbookFormulaCount(workbook: Workbook) {
  return workbook.sheets.reduce((total, sheet) => total + Object.values(sheet.cells).filter(cell => cell.kind === 'formula').length, 0)
}

function validNewSheetName(name: string, workbook: Workbook, currentId?: string) {
  if (!name || name.length > 31 || /[\\/:*?[\]]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32) ||
    name.startsWith("'") || name.endsWith("'")) {
    throw new Error('Enter a worksheet name of 1–31 characters, without Excel-reserved punctuation.')
  }
  if (workbook.sheets.some(sheet => sheet.id !== currentId && sheet.name.toLowerCase() === name.toLowerCase())) throw new Error('A worksheet already uses that name.')
}

function addReferenceChanges(workbook: Workbook, original: string, replacement?: string) {
  return { ...workbook, sheets: workbook.sheets.map(sheet => {
    let cells: Sheet['cells'] | undefined
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.kind !== 'formula') continue
      const value = rewriteSheetReferences(String(cell.value), original, replacement)
      if (value === cell.value) continue
      cells ??= { ...sheet.cells }
      cells[address] = { ...cell, value, cached: undefined }
    }
    return cells ? { ...sheet, cells } : sheet
  }) }
}

function complexSheetReferences(workbook: Workbook) {
  return workbook.sheets.some(sheet => Object.values(sheet.cells).some(cell => cell.kind === 'formula' &&
    /(?:\bINDIRECT\s*\(|\[[^\]]+\]|!\$?[A-Z]{1,3}:\$?[A-Z]{1,3}|!\$?\d+:\$?\d+|(?:'[^']+'|[\w.]+):(?:'[^']+'|[\w.]+)!)/i.test(String(cell.value))))
}

function expandedSelection(sheet: Sheet, selection: Selection) {
  let range = normalizeRange(selection.anchor, selection.end)
  for (;;) {
    const previous = range
    for (const merge of sheet.merges) {
      if (intersects(range, merge)) range = { row: Math.min(range.row, merge.row), col: Math.min(range.col, merge.col),
        endRow: Math.max(range.endRow, merge.endRow), endCol: Math.max(range.endCol, merge.endCol) }
    }
    if (range.row === previous.row && range.col === previous.col && range.endRow === previous.endRow && range.endCol === previous.endCol) return range
  }
}

function clipboardRows(source: string) {
  const rows: string[][] = [[]]
  let value = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"' && (quoted || !value)) {
      if (quoted && source[index + 1] === '"') { value += '"'; index++ }
      else quoted = !quoted
    } else if (!quoted && (char === '\t' || char === '\r' || char === '\n')) {
      rows.at(-1)!.push(value)
      value = ''
      if (char !== '\t') {
        if (char === '\r' && source[index + 1] === '\n') index++
        if (index !== source.length - 1) rows.push([])
        else return rows
      }
    } else value += char
  }
  rows.at(-1)!.push(value)
  return rows
}

function clipboardField(value: string) {
  return /[\t\r\n"]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value
}

function currencyFormat(locale: string) {
  const region = new Intl.Locale(locale).maximize().region
  if (region === 'CA') return '"CAD "#,##0.00'
  if (region === 'GB') return '"£"#,##0.00'
  if (region === 'JP') return '"¥"#,##0'
  if (['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'].includes(region ?? '')) return '"€"#,##0.00'
  return '"$"#,##0.00'
}

export function SpreadsheetEditor({ workbook, format, title, onChange, readOnly = false, status, onSave, saveLabel = 'Save draft', onOriginal, onExport,
  onUndo, onRedo, canUndo, canRedo, onCsvDialect }: Props) {
  const [sheetId, setSheetId] = useState(workbook.sheets[0].id)
  const sheet = workbook.sheets.find(item => item.id === sheetId) ?? workbook.sheets[0]
  const [selection, setSelection] = useState<Selection>({ anchor: initialPoint, end: initialPoint })
  const range = useMemo(() => expandedSelection(sheet, selection), [sheet, selection])
  const selectedMerge = sheet.merges.find(item => contains(item, selection.anchor.row, selection.anchor.col))
  const active = selectedMerge ? { row: selectedMerge.row, col: selectedMerge.col } : selection.anchor
  const activeAddress = cellAddress(active.row, active.col)
  const cell = sheet.cells[activeAddress]
  const style = cell?.style ?? {}
  const [formulaDraft, setFormulaDraft] = useState<{ address: string; value: string }>()
  const [nameDraft, setNameDraft] = useState<string>()
  const [editing, setEditing] = useState<GridEditing>()
  const [dialog, setDialog] = useState<Dialog>()
  const [exporting, setExporting] = useState<ExportState>()
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState<{ rows: number; cols: number; styles: (CellStyle | undefined)[] }>()
  const [border, setBorder] = useState<Border>(defaultBorder)
  const [mergeCentered, setMergeCentered] = useState(false)
  const [context, setContext] = useState<{ axis?: Axis; point: Point; x: number; y: number }>()
  const [resize, setResize] = useState<{ axis: Axis; index: number }>()
  const [allowedCalculation, setAllowedCalculation] = useState(!workbook.imported)
  const [calculation, setCalculation] = useState<{ workbook: Workbook; result?: Calculation; error?: string; busy?: boolean }>()
  const [calculationRequest, setCalculationRequest] = useState(0)
  const scroll = useRef<HTMLDivElement>(null)
  const contextMenu = useRef<HTMLDivElement>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const history = useRef<{ past: Workbook[]; future: Workbook[] }>({ past: [], future: [] })
  const committed = useRef(new WeakSet<Workbook>())
  const [, refreshHistory] = useState(0)
  const workbookRef = useRef(workbook)
  const sheetTabsId = useId()
  const selectedTabId = sheetTabsId + '-' + sheet.id
  const formulaCount = useMemo(() => format === 'xlsx' ? workbookFormulaCount(workbook) : 0, [format, workbook])
  const formulaDisabled = !allowedCalculation || !formulaCount
  const result = !formulaDisabled && calculation?.workbook === workbook ? calculation.result : undefined
  const sheetCalculation = result?.[sheet.id]
  const cancelCalculation = useRef<AbortController>(undefined)
  const bounds = useMemo(() => bounding(sheet), [sheet])
  const disabled = readOnly

  useEffect(() => {
    if (workbookRef.current !== workbook && !committed.current.has(workbook)) {
      history.current = { past: [], future: [] }
      refreshHistory(value => value + 1)
    }
    workbookRef.current = workbook
  }, [workbook])

  useEffect(() => {
    if (formulaDisabled) return
    const controller = new AbortController()
    cancelCalculation.current = controller
    const timer = window.setTimeout(() => {
      setCalculation({ workbook, busy: true })
      void import('../../document/formats/spreadsheet/workerClient').then(module => module.calculateWorkbook(workbook, controller.signal)).then(result => {
        if (!controller.signal.aborted) setCalculation({ workbook, result })
      }).catch(error => {
        if (!controller.signal.aborted) setCalculation({ workbook, error: error instanceof Error ? error.message : 'Calculation is unavailable.' })
      })
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [calculationRequest, formulaDisabled, workbook])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 4600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [sheet.id])

  useEffect(() => {
    if (!context) return
    contextMenu.current?.querySelector('button')?.focus()
    const close = (event: PointerEvent) => { if (!contextMenu.current?.contains(event.target as Node)) setContext(undefined) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [context])

  function report(error: unknown) {
    setNotice(error instanceof Error ? error.message : 'The spreadsheet change could not be applied.')
  }

  function focus() { requestAnimationFrame(() => scroll.current?.focus({ preventScroll: true })) }
  function dismiss() { setDialog(undefined); focus() }
  function update(next: Workbook, track = true) {
    if (readOnly || next === workbook) return
    try {
      if (track && !onUndo) {
        history.current.past = [...history.current.past.slice(-(historyLimit - 1)), workbook]
        history.current.future = []
      }
      committed.current.add(next)
      onChange(next)
      refreshHistory(value => value + 1)
    } catch (error) {
      if (track && !onUndo) history.current.past.pop()
      report(error)
    }
  }

  function undo() {
    if (readOnly) return
    if (onUndo) onUndo()
    else {
      const prior = history.current.past.pop()
      if (!prior) return
      history.current.future.push(workbook)
      update(prior, false)
    }
    focus()
  }
  function redo() {
    if (readOnly) return
    if (onRedo) onRedo()
    else {
      const next = history.current.future.pop()
      if (!next) return
      history.current.past.push(workbook)
      update(next, false)
    }
    focus()
  }

  function replaceSheet(next: Sheet) { update(patchSheet(workbook, next)) }
  function select(point: Point, extend = false) {
    if (!extend) { setNameDraft(undefined); setFormulaDraft(undefined) }
    setSelection(previous => ({ anchor: extend ? previous.anchor : point, end: point }))
  }
  function selectAxis(axis: Axis, index: number, extend: boolean) {
    if (editing) commitEditing()
    setSelection(previous => {
      if (axis === 'row') return { anchor: { row: extend ? previous.anchor.row : index, col: 1 }, end: { row: index, col: spreadsheetLimits.cols } }
      return { anchor: { row: 1, col: extend ? previous.anchor.col : index }, end: { row: spreadsheetLimits.rows, col: index } }
    })
  }
  function switchSheet(target: Sheet, point = initialPoint) {
    if (sheet.id !== target.id && scroll.current) scroll.current.scrollTo(0, 0)
    setSheetId(target.id)
    setEditing(undefined)
    select(point)
    focus()
  }
  function move(direction: Direction, extend = false) {
    const point = extend ? selection.end : active
    const colAxis = direction === 'left' || direction === 'right'
    const sign = direction === 'left' || direction === 'up' ? -1 : 1
    const merge = sheet.merges.find(item => contains(item, point.row, point.col))
    const axis = colAxis ? 'col' : 'row'
    const limit = colAxis ? spreadsheetLimits.cols : spreadsheetLimits.rows
    const metrics = axisMetrics(limit, colAxis ? defaultWidth : defaultHeight, colAxis ? sheet.widths : sheet.heights, colAxis ? sheet.hiddenCols : sheet.hiddenRows)
    const edge = merge ? sign < 0 ? merge[axis] : colAxis ? merge.endCol : merge.endRow : point[axis]
    const candidate = Math.min(limit, Math.max(1, edge + sign))
    const position = metrics.offset(candidate)
    const index = metrics.size(candidate) ? candidate : metrics.index(Math.max(0, position - Number(sign < 0)))
    select({ ...point, [axis]: index }, extend)
  }

  function changeCells(target: Range, transform: (cell: Cell | undefined, point: Point) => Cell | undefined,
    options: { sparse?: boolean; csvInputWidth?: (row: number) => number } = {}) {
    if (readOnly) return
    try {
      if (!options.sparse && rangeSize(target) > spreadsheetLimits.rangeCells) throw new Error('Select at most 20,000 cells for this operation.')
      const cells = { ...sheet.cells }
      let changed = false
      const set = (row: number, col: number) => {
        const address = cellAddress(row, col)
        const previous = cells[address]
        const next = transform(previous, { row, col })
        if (JSON.stringify(next) === JSON.stringify(previous)) return
        if (next) cells[address] = next
        else delete cells[address]
        changed = true
      }
      if (options.sparse) {
        for (const address of Object.keys(cells)) {
          const point = parseAddress(address)
          if (point && contains(target, point.row, point.col)) set(point.row, point.col)
        }
      } else {
        for (let row = target.row; row <= target.endRow; row++) for (let col = target.col; col <= target.endCol; col++) set(row, col)
      }
      if (changed && Object.keys(cells).length + workbook.sheets.filter(item => item.id !== sheet.id)
        .reduce((sum, item) => sum + Object.keys(item.cells).length, 0) > spreadsheetLimits.cells) {
        throw new Error('This edit would exceed the workbook limit of 150,000 stored cells.')
      }
      if (workbook.csv && options.csvInputWidth) {
        const rowWidths = workbook.csv.rowWidths.slice()
        if (target.endRow > spreadsheetLimits.cells) throw new Error('CSV drafts support up to 150,000 fields.')
        for (let row = rowWidths.length + 1; row < target.row; row++) rowWidths[row - 1] = 1
        for (let row = target.row; row <= target.endRow; row++) {
          rowWidths[row - 1] = Math.max(rowWidths[row - 1] ?? 1, target.col + options.csvInputWidth(row) - 1)
        }
        replaceCsvShape({ ...sheet, cells: changed ? cells : sheet.cells }, rowWidths)
      } else if (changed) replaceSheet({ ...sheet, cells })
    } catch (error) { report(error) }
  }

  function replaceCsvShape(next: Sheet, rowWidths: number[]) {
    if (!workbook.csv) return
    let cells = 0
    let columns = 0
    for (const width of rowWidths) {
      cells += width
      columns = Math.max(columns, width)
    }
    if (cells > spreadsheetLimits.cells || columns > spreadsheetLimits.cols) throw new Error('CSV drafts support up to 150,000 fields.')
    update({ ...patchSheet(workbook, { ...next, rowCount: rowWidths.length, colCount: columns }), csv: { ...workbook.csv, rowWidths } })
  }

  function stylePatch(update: Partial<CellStyle> | ((style: CellStyle) => CellStyle)) {
    changeCells(range, previous => {
      const old = previous?.style ?? {}
      const style = typeof update === 'function' ? update(old) : { ...old, ...update }
      return { ...(previous ?? { kind: 'text', value: '' }), style }
    })
  }
  function clearStyles() {
    changeCells(range, previous => {
      if (!previous) return
      const { style: ignored, ...cell } = previous
      return cell.value !== '' || cell.link ? cell : undefined
    }, { sparse: true })
  }
  function clearValues() { changeCells(range, previous => valueWithoutFormatting(previous, undefined), { sparse: true }) }
  function copyStyle() {
    if (rangeSize(range) > spreadsheetLimits.rangeCells) { setNotice('Select at most 20,000 cells to copy styles.'); return }
    const styles = []
    for (let row = range.row; row <= range.endRow; row++) for (let col = range.col; col <= range.endCol; col++) styles.push(sheet.cells[cellAddress(row, col)]?.style)
    setCopied({ rows: range.endRow - range.row + 1, cols: range.endCol - range.col + 1, styles })
    setNotice('Styles copied. Select a destination and choose Apply copied styles.')
  }
  function applyCopiedStyle() {
    if (!copied) return
    const target = rangeSize(range) === 1 ? { ...range, endRow: Math.min(spreadsheetLimits.rows, range.row + copied.rows - 1),
      endCol: Math.min(spreadsheetLimits.cols, range.col + copied.cols - 1) } : range
    changeCells(target, (previous, point) => {
      const style = copied.styles[((point.row - target.row) % copied.rows) * copied.cols + (point.col - target.col) % copied.cols]
      if (!style) return previous && (previous.value !== '' || previous.link) ? { ...previous, style: undefined } : undefined
      return { ...(previous ?? { kind: 'text', value: '' }), style }
    })
  }
  function setBorderMode(mode: BorderMode) {
    changeCells(range, (previous, point) => {
      if (mode === 'none' && !previous?.style?.borders) return previous
      const borders = mode === 'none' ? undefined : { ...previous?.style?.borders }
      if (borders) {
        if (mode === 'all' || (mode === 'outside' || mode === 'top') && point.row === range.row) borders.top = border
        if (mode === 'all' || (mode === 'outside' || mode === 'right') && point.col === range.endCol) borders.right = border
        if (mode === 'all' || (mode === 'outside' || mode === 'bottom') && point.row === range.endRow) borders.bottom = border
        if (mode === 'all' || (mode === 'outside' || mode === 'left') && point.col === range.col) borders.left = border
      }
      return { ...(previous ?? { kind: 'text', value: '' }), style: { ...previous?.style, borders } }
    })
  }

  function writeCell(point: Point, raw: string): boolean {
    if (readOnly) return false
    try {
      const address = cellAddress(point.row, point.col)
      // Preserve imported type and cache when the user accepts an unchanged formula or value.
      if (raw === cellInput(sheet.cells[address])) return true
      const next = enterCell(raw, format)
      changeCells(normalizeRange(point, point), previous => valueWithoutFormatting(previous, next), { csvInputWidth: () => 1 })
      return true
    } catch (error) { report(error); return false }
  }
  function beginEditing(point = active, seed?: string) {
    if (readOnly) return
    select(point)
    const address = cellAddress(point.row, point.col)
    setEditing({ value: seed ?? cellInput(sheet.cells[address]), key: address })
  }
  function commitEditing(direction?: Direction) {
    if (!editing) return
    const point = parseAddress(editing.key)
    if (point && !writeCell(point, editing.value)) return
    setEditing(undefined)
    if (direction) { move(direction); focus() }
  }
  function commitFormula() {
    if (formulaDraft?.address === activeAddress && writeCell(active, formulaDraft.value)) setFormulaDraft(undefined)
  }
  function commitName() {
    if (nameDraft === undefined) return
    const target = parseRange(nameDraft)
    if (target) {
      setSelection({ anchor: { row: target.row, col: target.col }, end: { row: target.endRow, col: target.endCol } })
      setNameDraft(undefined)
    } else { setNotice('Enter an A1 cell address or range, such as B2:D8.'); setNameDraft(undefined) }
  }

  function copy(event: ClipboardEvent<HTMLDivElement>, cut: boolean) {
    if ((event.target as HTMLElement).closest('input, textarea')) return
    event.preventDefault()
    if (rangeSize(range) > spreadsheetLimits.rangeCells) { setNotice('Select at most 20,000 cells to copy or cut.'); return }
    const lines: string[] = []
    const typed: (Cell | undefined)[][] = []
    let length = 0
    for (let row = range.row; row <= range.endRow; row++) {
      const line = []
      const typedRow = []
      for (let col = range.col; col <= range.endCol; col++) {
        const address = cellAddress(row, col)
        const cell = sheet.cells[address]
        line.push(clipboardField(cellInput(cell)))
        typedRow.push(cell)
      }
      const text = line.join('\t')
      length += text.length + 1
      if (length > clipboardCharacterLimit) { setNotice('The selection is too large to copy.'); return }
      lines.push(text)
      typed.push(typedRow)
    }
    const packet = encodeTypedClipboard(typed, workbook.date1904)
    if (packet.length > clipboardCharacterLimit) { setNotice('The selection is too large to copy.'); return }
    event.clipboardData.setData('text/plain', lines.join('\n'))
    event.clipboardData.setData(typedClipboardMime, packet)
    if (cut && !readOnly) clearValues()
  }
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (readOnly || (event.target as HTMLElement).closest('input, textarea')) return
    event.preventDefault()
    const source = event.clipboardData.getData('text/plain')
    const packet = event.clipboardData.getData(typedClipboardMime)
    const typed = format === 'xlsx' ? decodeTypedClipboard(packet, workbook.date1904) : undefined
    if (!source && !typed) return
    if (source.length > clipboardCharacterLimit) { setNotice('Paste up to two million characters at a time.'); return }
    const lines = typed ?? clipboardRows(source)
    const width = lines.reduce((max, line) => Math.max(max, line.length), 0)
    const target = { ...active, endRow: active.row + lines.length - 1, endCol: active.col + width - 1 }
    if (target.endRow > spreadsheetLimits.rows || target.endCol > spreadsheetLimits.cols || rangeSize(target) > spreadsheetLimits.rangeCells) {
      setNotice('The pasted selection exceeds worksheet limits.'); return
    }
    changeCells(target, (previous, point) => {
      const row = point.row - target.row
      const col = point.col - target.col
      if (typed) return valueWithoutFormatting(previous, typed[row][col])
      const value = lines[row]?.[col]
      if (typeof value !== 'string') return previous
      return valueWithoutFormatting(previous, enterCell(value, format))
    }, { csvInputWidth: row => lines[row - target.row].length })
    setSelection({ anchor: active, end: { row: target.endRow, col: target.endCol } })
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('input, textarea')) return
    const command = event.ctrlKey || event.metaKey
    if (command) {
      switch (event.key.toLowerCase()) {
        case 'z': event.preventDefault(); event.stopPropagation(); if (event.shiftKey) redo(); else undo(); return
        case 'y': event.preventDefault(); event.stopPropagation(); redo(); return
        case 'f': event.preventDefault(); event.stopPropagation(); setDialog('find'); return
        case 's': if (onSave) { event.preventDefault(); event.stopPropagation(); onSave() } return
        case 'a': event.preventDefault(); setSelection({ anchor: initialPoint, end: bounds }); return
        case 'b': event.preventDefault(); stylePatch({ bold: !style.bold }); return
        case 'i': event.preventDefault(); stylePatch({ italic: !style.italic }); return
        case 'u': event.preventDefault(); stylePatch({ underline: !style.underline }); return
      }
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      move(event.key.slice(5).toLowerCase() as Direction, event.shiftKey)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      move(event.key === 'Enter' ? event.shiftKey ? 'up' : 'down' : event.shiftKey ? 'left' : 'right')
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      select({ row: command ? event.key === 'Home' ? 1 : bounds.row : active.row, col: event.key === 'Home' ? 1 : bounds.col }, event.shiftKey)
    } else if (!readOnly && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      clearValues()
    } else if (!readOnly && !command && !event.altKey && (event.key.length === 1 || event.key === 'F2')) {
      event.preventDefault()
      beginEditing(active, event.key === 'F2' ? undefined : event.key)
    }
  }

  function mergeRange(center: boolean) {
    if (rangeSize(range) === 1) { setNotice('Select at least two cells to merge.'); return }
    if (rangeSize(range) > spreadsheetLimits.rangeCells) { setNotice('Select at most 20,000 cells to merge.'); return }
    if (sheet.merges.some(item => intersects(item, range))) { setNotice('Unmerge intersecting cells before creating a new merge.'); return }
    const anchor = cellAddress(range.row, range.col)
    const hidden = Object.entries(sheet.cells).some(([address, cell]) => {
      const point = parseAddress(address)
      return address !== anchor && cell.value !== '' && point && contains(range, point.row, point.col)
    })
    if (hidden) { setMergeCentered(center); setDialog('merge') }
    else saveMerge(center)
  }
  function saveMerge(center: boolean) {
    const address = cellAddress(range.row, range.col)
    const existing = sheet.cells[address] ?? { kind: 'text', value: '' } as Cell
    const cells = center ? { ...sheet.cells, [address]: { ...existing, style: { ...existing.style, horizontal: 'center' as const } } } : sheet.cells
    replaceSheet({ ...sheet, cells, merges: [...sheet.merges, range] })
  }
  function unmerge() {
    const merges = sheet.merges.filter(item => !intersects(item, range))
    if (merges.length !== sheet.merges.length) replaceSheet({ ...sheet, merges })
  }

  function addSheet(duplicate = false) {
    if (readOnly || format === 'csv') return
    if (workbook.sheets.length >= spreadsheetLimits.sheets) { setNotice('This workbook already contains 64 worksheets.'); return }
    const count = duplicate ? workbook.sheets.reduce((total, item) => total + Object.keys(item.cells).length, Object.keys(sheet.cells).length) : 0
    if (count > spreadsheetLimits.cells) { setNotice('Duplicating this sheet would exceed the workbook cell limit.'); return }
    let serial = 1
    let name: string
    do {
      const suffix = duplicate ? ' copy' + (serial === 1 ? '' : ' ' + serial) : String(serial)
      name = duplicate ? sheet.name.slice(0, 31 - suffix.length) + suffix : 'Sheet' + suffix
      serial++
    } while (workbook.sheets.some(item => item.name.toLowerCase() === name.toLowerCase()))
    const next = createSheet(name)
    if (duplicate) Object.assign(next, { ...sheet, id: next.id, name, rules: sheet.rules.map(rule => ({ ...rule, id: crypto.randomUUID() })) })
    update({ ...workbook, sheets: [...workbook.sheets, next] })
    switchSheet(next)
  }
  function renameSheet(name: string) {
    validNewSheetName(name, workbook, sheet.id)
    if (name === sheet.name) return
    if (complexSheetReferences(workbook)) throw new Error('This workbook has advanced formula references that Folio cannot update during sheet rename.')
    update(addReferenceChanges(patchSheet(workbook, { ...sheet, name }), sheet.name, name))
  }
  function deleteSheet() {
    if (workbook.sheets.length <= 1) return
    if (complexSheetReferences(workbook)) throw new Error('This workbook has advanced formula references that Folio cannot update during sheet deletion.')
    const index = workbook.sheets.indexOf(sheet)
    const remaining = workbook.sheets.filter(item => item.id !== sheet.id)
    update(addReferenceChanges({ ...workbook, sheets: remaining }, sheet.name))
    switchSheet(remaining[Math.min(remaining.length - 1, index)])
  }
  function reorder(offset: number) {
    const sheets = [...workbook.sheets]
    const index = sheets.indexOf(sheet)
    if (index + offset < 0 || index + offset >= sheets.length) return
    if (complexSheetReferences(workbook)) { setNotice('Advanced formula references must be resolved before reordering these worksheets.'); return }
    ;[sheets[index], sheets[index + offset]] = [sheets[index + offset], sheets[index]]
    update({ ...workbook, sheets })
  }

  function resizeAxis(axis: Axis, index: number, value: number) {
    if (!Number.isFinite(value)) throw new Error('Enter a whole number of pixels.')
    const size = Math.max(axis === 'row' ? 16 : 24, Math.min(1000, Math.round(value)))
    const key = axis === 'row' ? 'heights' : 'widths'
    replaceSheet({ ...sheet, [key]: { ...sheet[key], [index]: size } })
  }
  function structure(axis: Axis, index: number, insert: boolean) {
    if (formulaCount) { setNotice('Row and column insertion and deletion require a workbook without formulas.'); return }
    const limit = axis === 'row' ? spreadsheetLimits.rows : spreadsheetLimits.cols
    if (insert && bounds[axis] >= limit) { setNotice('This insertion would move cells beyond the worksheet boundary.'); return }
    const next = shiftSheet(sheet, axis, index, insert)
    try {
      if (workbook.csv) replaceCsvShape(next, shiftCsvRows(workbook.csv.rowWidths, axis, index, insert))
      else replaceSheet(next)
    } catch (error) { report(error) }
  }
  function toggleHidden(axis: Axis, index?: number) {
    const key = axis === 'row' ? 'hiddenRows' : 'hiddenCols'
    const current = sheet[key] ?? []
    replaceSheet({ ...sheet, [key]: index !== undefined ? [...new Set([...current, index])] : [] })
    if (index !== undefined) select({ ...active, [axis]: index === (axis === 'row' ? spreadsheetLimits.rows : spreadsheetLimits.cols) ? index - 1 : index + 1 })
  }
  function openContext(event: MouseEvent, point: Point, axis?: Axis) {
    event.preventDefault()
    if (axis) selectAxis(axis, point[axis], false)
    else if (!contains(range, point.row, point.col)) select(point)
    setContext({ axis, point, x: Math.min(event.clientX, window.innerWidth - 224), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 338)) })
  }
  function contextItems(): Item[] {
    if (!context) return []
    const { axis, point } = context
    if (!axis) return [
      { label: 'Edit cell', disabled, run: () => beginEditing(active) },
      { label: 'Clear values', disabled, run: clearValues },
      { label: 'Clear formatting', disabled, run: clearStyles },
      { label: 'Copy styles', disabled, run: copyStyle },
      { label: 'Apply copied styles', disabled: disabled || !copied, run: applyCopiedStyle },
      { label: 'Export selected range as PNG…', run: () => openExport('png') },
    ]
    const name = axis === 'row' ? 'row' : 'column'
    const index = point[axis]
    const frozen = axis === 'row' ? 'frozenRows' : 'frozenCols'
    return [
      { label: 'Insert ' + name + (axis === 'row' ? ' above' : ' to the left'), disabled, run: () => structure(axis, index, true) },
      { label: 'Delete ' + name, disabled, run: () => structure(axis, index, false) },
      { label: 'Resize ' + name + '…', disabled, run: () => { setResize({ axis, index }); setDialog('resize') } },
      { label: 'Hide ' + name, disabled, run: () => toggleHidden(axis, index) },
      { label: 'Show all ' + name + 's', disabled, run: () => toggleHidden(axis) },
      { label: 'Freeze through this ' + name, disabled: disabled || index > 80, run: () => replaceSheet({ ...sheet, [frozen]: index }) },
      { label: 'Unfreeze ' + name + 's', disabled: disabled || !sheet[frozen], run: () => replaceSheet({ ...sheet, [frozen]: 0 }) },
    ]
  }
  function openExport(target: ExportState['target']) {
    setExporting({ target, workbook, sheet, range, calculation: sheetCalculation,
      includeCalculated: target === 'xlsx' && allowedCalculation && !!result })
  }
  function closeExport() { setExporting(undefined); focus() }
  async function deliver(request: SpreadsheetExportRequest) {
    request.signal?.throwIfAborted()
    if (request.confirmedWorkbook !== workbookRef.current) throw new Error('The workbook changed. Open a new export review.')
    return onExport(request)
  }
  const hasWarnings = workbook.warnings.length > 0
  const calculationState = calculation?.workbook === workbook ? calculation : undefined
  const calculationLabel = formulaCount && !allowedCalculation ? 'Stored results' : calculationState?.busy ? 'Calculating' :
    calculationState?.error ? 'Calculation limited' : result ? 'Calculated' : formulaCount ? 'Calculation ready' : ''
  const index = workbook.sheets.indexOf(sheet)

  return <section className="folio-spreadsheet" aria-label="Spreadsheet editor">
    <header className="folio-sheet-header">
      <div className="folio-sheet-identity"><span className="folio-sheet-file-icon"><FileSpreadsheet size={17} /></span>
        <div><h1 title={title}>{title}</h1><span>{format === 'xlsx' ? 'Excel workbook' : 'CSV worksheet'}</span></div>
      </div>
      <div className="folio-sheet-actions">
        {status && <span className="folio-sheet-status" role="status"><Check size={12} />{status}</span>}
        {hasWarnings && <IconButton label="Workbook compatibility" onClick={() => setDialog('warnings')}><CircleAlert size={17} /></IconButton>}
        <IconButton label="Formula reference" onClick={() => setDialog('reference')}><HelpCircle size={18} /></IconButton>
        <Menu label="Export copies" align="right" chevron className="folio-sheet-export" items={[
          { label: 'Export XLSX copy…', run: () => openExport('xlsx') },
          { label: 'Export CSV copy…', run: () => openExport('csv') },
          { label: 'Export selected range as PNG…', run: () => openExport('png') },
          ...(onOriginal ? [{ label: 'Download original', run: onOriginal }] : []),
        ]}><ArrowDownToLine size={15} /><span>Export</span></Menu>
        {onSave && <button className="primary-button" type="button" disabled={readOnly} onClick={onSave}>{saveLabel}</button>}
      </div>
    </header>
    <SpreadsheetToolbar style={style} readOnly={readOnly} canUndo={canUndo ?? (onUndo ? true : history.current.past.length > 0)}
      canRedo={canRedo ?? (onRedo ? true : history.current.future.length > 0)} undo={undo} redo={redo} stylePatch={stylePatch}
      clearStyles={clearStyles} clearValues={clearValues} copyStyle={copyStyle} usableStyle={!!copied} applyCopiedStyle={applyCopiedStyle}
      border={setBorderMode} dialog={setDialog} merge={mergeRange} unmerge={unmerge} gridLines={sheet.gridLines}
      toggleGrid={() => replaceSheet({ ...sheet, gridLines: !sheet.gridLines })} find={() => setDialog('find')}
      rangePng={() => openExport('png')} currency={currencyFormat(workbook.locale)} />
    {workbook.csv?.ambiguous && <div className="folio-sheet-csv-banner" role="status"><CircleAlert size={15} />
      <span>Check the detected delimiter against the columns below.</span>
      {onCsvDialect && <button type="button" className="secondary-button" onClick={() => setDialog('dialect')}>Choose delimiter</button>}
    </div>}
    <div className="folio-sheet-formula">
      <input aria-label="Name box" className="folio-sheet-name" value={nameDraft ?? rangeAddress(range)} title="Go to a cell or range"
        onChange={event => setNameDraft(event.target.value)} spellCheck={false} maxLength={32} onBlur={commitName}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commitName(); focus() }
          if (event.key === 'Escape') { event.preventDefault(); setNameDraft(undefined); focus() }
        }} />
      <button type="button" title="Formula reference" aria-label="Open formula reference" className="folio-sheet-fx" onClick={() => setDialog('reference')}>ƒx</button>
      <textarea aria-label="Formula bar" className="folio-sheet-formula-field" autoComplete="off" spellCheck={false} readOnly={readOnly} rows={1}
        title="Enter to apply. Alt+Enter inserts a line break."
        value={editorText(formulaDraft?.address === activeAddress ? formulaDraft.value : editing?.key === activeAddress ? editing.value : cellInput(cell))}
        maxLength={spreadsheetLimits.cellLength} onChange={event => setFormulaDraft({ address: activeAddress,
          value: applyEditorText(formulaDraft?.address === activeAddress ? formulaDraft.value : cellInput(cell), event.target.value) })} onBlur={commitFormula}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.altKey) { event.preventDefault(); commitFormula(); focus() }
          if (event.key === 'Escape') { event.preventDefault(); setFormulaDraft(undefined); focus() }
        }} />
      {format === 'xlsx' && calculationLabel && <button className="folio-sheet-calculation" type="button" title="Formula calculation options"
        onClick={() => setDialog('calculation')}><Sigma size={13} />{calculationLabel}</button>}
    </div>
    <div className="folio-sheet-grid-frame">
      <SpreadsheetGrid sheet={sheet} locale={workbook.locale} date1904={workbook.date1904} calculated={sheetCalculation}
        range={range} active={active} scrollRef={scroll} editing={editing} readOnly={readOnly} header={workbook.csv?.header}
        onSelect={select} onSelectAxis={selectAxis} onBeginEdit={beginEditing}
        onEdit={value => setEditing(previous => previous && { ...previous, value: applyEditorText(previous.value, value) })}
        onCommit={commitEditing} onCancel={() => { setEditing(undefined); focus() }} onKey={key}
        onCopy={copy} onPaste={paste} onResize={resizeAxis} onContext={openContext} />
      {notice && <div role="status" className="folio-sheet-toast"><span>{notice}</span><IconButton label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></IconButton></div>}
    </div>
    <footer className="folio-sheet-footer">
      <div className="folio-sheet-tab-tools">
        {format === 'xlsx' && <IconButton label="Add worksheet" disabled={disabled} onClick={() => addSheet()}><Plus size={18} /></IconButton>}
        <Menu label="All worksheets" value={sheet.name} className="folio-sheet-bottom-menu" items={workbook.sheets.map(item => ({ label: item.name, active: item.id === sheet.id,
          run: () => switchSheet(item) }))}><List size={17} /></Menu>
      </div>
      <div ref={tabs} className="folio-sheet-tabs" role="tablist" aria-label="Worksheets">
        {workbook.sheets.map((item, tabIndex) => <button type="button" role="tab" aria-selected={item.id === sheet.id} key={item.id}
          id={sheetTabsId + '-' + item.id} tabIndex={item.id === sheet.id ? 0 : -1} title={item.name}
          onClick={() => switchSheet(item)} onDoubleClick={() => { if (!disabled && format === 'xlsx') setDialog('rename') }}
          onKeyDown={event => {
            const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
            if (!step) return
            event.preventDefault()
            const target = workbook.sheets[(tabIndex + step + workbook.sheets.length) % workbook.sheets.length]
            setSheetId(target.id)
            select(initialPoint)
            requestAnimationFrame(() => document.getElementById(sheetTabsId + '-' + target.id)?.focus())
          }}>{item.name}</button>)}
      </div>
      <div className="folio-sheet-dock-actions">
        {format === 'xlsx' && <Menu label="Worksheet options" value={sheet.name} align="right" className="folio-sheet-bottom-menu" items={[
          { label: 'Rename worksheet…', disabled, run: () => setDialog('rename') },
          { label: 'Duplicate worksheet', disabled, run: () => addSheet(true) },
          { label: 'Move worksheet left', disabled: disabled || index === 0, run: () => reorder(-1) },
          { label: 'Move worksheet right', disabled: disabled || index === workbook.sheets.length - 1, run: () => reorder(1) },
          { divider: true, label: '' },
          { label: 'Delete worksheet…', disabled: disabled || workbook.sheets.length === 1, run: () => setDialog('delete') },
        ]}><ChevronDown size={15} /></Menu>}
        {workbook.csv && <Menu label="CSV options" align="right" className="folio-sheet-bottom-menu" chevron items={[
          { label: workbook.csv.header ? 'Treat first row as data' : 'Treat first row as headers', disabled,
            run: () => { if (workbook.csv) update({ ...workbook, csv: { ...workbook.csv, header: !workbook.csv.header } }) } },
          ...(onCsvDialect ? [{ label: 'Choose delimiter…', disabled, run: () => setDialog('dialect') }] : []),
        ]}>CSV</Menu>}
        <button className="folio-sheet-region" type="button" aria-label="Regional settings" title="Regional settings" onClick={() => setDialog('regional')}>
          <Globe2 size={14} /><span>{workbook.locale}</span><span className="folio-sheet-timezone">{workbook.timezone}</span>
        </button>
      </div>
    </footer>
    <span className="folio-sheet-visually-hidden" aria-live="polite" aria-describedby={selectedTabId}>{rangeAddress(range)} selected</span>
    {context && <div role="menu" aria-label={context.axis ? 'Row or column options' : 'Cell options'} className="dropdown folio-sheet-context"
      style={{ left: Math.max(8, context.x), top: context.y }} ref={contextMenu}
      onKeyDown={event => {
        const buttons = Array.from(contextMenu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const current = buttons.indexOf(event.target as HTMLButtonElement)
        if (event.key === 'Escape') { event.preventDefault(); setContext(undefined); focus() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }
      }}>{contextItems().map(item => <button type="button" key={item.label} role="menuitem" disabled={item.disabled} onClick={() => {
        setContext(undefined); item.run?.()
      }}>{item.label}</button>)}</div>}
    {dialog === 'reference' && <FormulaReference close={dismiss} />}
    {dialog === 'find' && <WorkbookFind workbook={workbook} calculated={result} close={dismiss} jump={switchSheet} />}
    {dialog === 'regional' && <RegionalDialog workbook={workbook} readOnly={readOnly} close={dismiss} change={update} />}
    {dialog === 'dialect' && workbook.csv && onCsvDialect && <DialectDialog csv={workbook.csv} close={dismiss} apply={onCsvDialect} />}
    {dialog === 'number' && <NumberDialog initial={style.numberFormat} close={dismiss} apply={numberFormat => stylePatch({ numberFormat })} />}
    {dialog === 'fontColor' && <ColorDialog title="Font color" initial={style.color} close={dismiss} apply={color => stylePatch({ color })} />}
    {dialog === 'fillColor' && <ColorDialog title="Fill color" initial={style.fill} close={dismiss} apply={fill => stylePatch({ fill })} />}
    {dialog === 'border' && <BorderDialog border={border} close={dismiss} apply={setBorder} />}
    {dialog === 'condition' && <ConditionalDialog rules={sheet.rules} range={range} close={dismiss} change={rules => replaceSheet({ ...sheet, rules })} />}
    {dialog === 'link' && <LinkDialog cell={cell} close={dismiss} apply={link => changeCells(normalizeRange(active, active), previous =>
      link ? { ...(previous ?? { kind: 'text', value: link }), link } : previous && { ...previous, link: undefined })} />}
    {dialog === 'rename' && <InputDialog title="Rename worksheet" label="Worksheet name" initial={sheet.name}
      maxLength={31} write={renameSheet} submitLabel="Rename" close={dismiss} />}
    {dialog === 'delete' && <ConfirmDialog title="Delete worksheet" message={'Deleting ' + sheet.name + ' removes its cells and can change formulas on other worksheets.'}
      label="Delete worksheet" confirm={deleteSheet} close={dismiss} />}
    {dialog === 'merge' && <ConfirmDialog title="Merge cells with existing values" message="The upper-left cell remains visible. Other values stay in the Folio draft and reappear when you unmerge. A workbook copy may omit those hidden values."
      label="Merge cells" confirm={() => saveMerge(mergeCentered)} close={dismiss} />}
    {dialog === 'resize' && resize && <InputDialog title={resize.axis === 'row' ? 'Resize row' : 'Resize column'} label="Size in pixels"
      initial={String((resize.axis === 'row' ? sheet.heights[resize.index] ?? defaultHeight : sheet.widths[resize.index] ?? defaultWidth))}
      write={value => resizeAxis(resize.axis, resize.index, Number(value))} maxLength={4} close={dismiss} />}
    {dialog === 'warnings' && <Modal title="Workbook compatibility" close={dismiss}>
      <div className="folio-sheet-dialog"><p>Folio preserves the original file. Review these details before exporting an edited copy.</p>
        <ul>{workbook.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>
    </Modal>}
    {dialog === 'calculation' && <Modal title="Formula calculation" close={dismiss}>
      <div className="folio-sheet-dialog">
        <p>{allowedCalculation ? 'Folio calculates supported formulas in an isolated IronCalc worker.' :
          'This session is showing stored formula results where available. Review this workbook before enabling supported local calculation.'}</p>
        {!result && <p>Stored formula results may be stale. The formula bar shows the original expression.</p>}
        {calculationState?.error && <p className="folio-sheet-error" role="status">{calculationState.error}</p>}
        <div className="dialog-actions">
          {calculationState?.busy && <button className="secondary-button" type="button" onClick={() => {
            cancelCalculation.current?.abort(); setCalculation({ workbook, error: 'Calculation canceled.' })
          }}><LoaderCircle size={14} className="spinner" /> Cancel calculation</button>}
          <button className="secondary-button" type="button" onClick={() => { setAllowedCalculation(false); dismiss() }}>Use stored results</button>
          <button className="primary-button" type="button" onClick={() => { setAllowedCalculation(true); setCalculationRequest(value => value + 1); dismiss() }}>
            {allowedCalculation ? 'Recalculate' : 'Enable local calculation'}
          </button>
        </div>
      </div>
    </Modal>}
    {exporting && <ExportDialog {...exporting} sourceFormat={format} title={title} calculated={exporting.calculation} close={closeExport} deliver={deliver} />}
  </section>
}
