import { useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { cellAddress, columnName, editorText, parseAddress, spreadsheetLimits, type CellStyle, type CellValue, type Point, type Range, type Sheet } from '../../document/formats/spreadsheet/model'
import { axisMetrics, columnHeaderHeight, contains, defaultHeight, defaultWidth, displayCell, fontFamily, intersects, rowHeaderWidth, ruleAppearance, wrapHeights } from './display'

export interface GridEditing { value: string; key: string }

interface GridProps {
  sheet: Sheet
  locale: string
  date1904: boolean
  calculated?: Record<string, CellValue>
  range: Range
  active: Point
  scrollRef: RefObject<HTMLDivElement | null>
  editing?: GridEditing
  readOnly: boolean
  header?: boolean
  onSelect: (point: Point, extend?: boolean) => void
  onSelectAxis: (axis: 'row' | 'col', index: number, extend: boolean) => void
  onBeginEdit: (point: Point) => void
  onEdit: (value: string) => void
  onCommit: (move?: 'right' | 'left' | 'up' | 'down') => void
  onCancel: () => void
  onKey: (event: KeyboardEvent<HTMLDivElement>) => void
  onCopy: (event: ClipboardEvent<HTMLDivElement>, cut: boolean) => void
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onContext: (event: MouseEvent, point: Point, axis?: 'row' | 'col') => void
  onResize: (axis: 'row' | 'col', index: number, value: number) => void
  onAutoFit: (axis: 'row' | 'col', index: number) => void
  /** Lets formula assistance consume a key in the cell editor. Returns true when handled. */
  onEditorKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  onEditorCursor?: (field: HTMLTextAreaElement) => void
  /** Requested caret offset after the editor value changes programmatically. */
  editorCursor?: { position: number; sequence: number }
  editorAssist?: { list: string; active?: string; expanded: boolean }
}

function cellStyle(style?: CellStyle): CSSProperties {
  if (!style) return {}
  const borders: CSSProperties = {}
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const border = style.borders?.[side.toLowerCase() as 'top' | 'right' | 'bottom' | 'left']
    if (!border) continue
    const width = border.style === 'medium' ? 2 : border.style === 'thick' || border.style === 'double' ? 3 : 1
    borders['border' + side as 'borderTop'] = [width + 'px', ['dotted', 'dashed', 'double'].includes(border.style) ? border.style : 'solid', border.color].join(' ')
  }
  return {
    ...borders,
    color: style.color,
    fontFamily: fontFamily(style.font),
    fontSize: style.size ? style.size * 4 / 3 : undefined,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
    justifyContent: style.vertical === 'top' ? 'flex-start' : style.vertical === 'middle' ? 'center' : undefined,
    textAlign: style.horizontal,
  }
}

const frozenViewLimit = 80

export function SpreadsheetGrid({ sheet, locale, date1904, calculated, range, active, scrollRef, editing, readOnly, header,
  onSelect, onSelectAxis, onBeginEdit, onEdit, onCommit, onCancel, onKey, onCopy, onPaste, onResize, onAutoFit, onContext,
  onEditorKey, onEditorCursor, editorCursor, editorAssist }: GridProps) {
  const rows = useMemo(() => axisMetrics(spreadsheetLimits.rows, defaultHeight, wrapHeights(sheet, locale, date1904), sheet.hiddenRows), [sheet, locale, date1904])
  const cols = useMemo(() => axisMetrics(spreadsheetLimits.cols, defaultWidth, sheet.widths, sheet.hiddenCols), [sheet.widths, sheet.hiddenCols])
  const conditional = useMemo(() => ruleAppearance(sheet, calculated), [sheet, calculated])
  const [viewport, setViewport] = useState({ top: 0, left: 0, width: 960, height: 480 })
  const pointer = useRef<number | undefined>(undefined)
  const input = useRef<HTMLTextAreaElement>(null)
  const frozenRows = Math.min(frozenViewLimit, sheet.frozenRows)
  const frozenCols = Math.min(frozenViewLimit, sheet.frozenCols)
  const frozenWidth = cols.offset(frozenCols + 1)
  const frozenHeight = rows.offset(frozenRows + 1)
  const activeAddress = cellAddress(active.row, active.col)

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    function measure() {
      if (!node) return
      const { scrollTop: top, scrollLeft: left, clientWidth: width, clientHeight: height } = node
      setViewport(previous => previous.top === top && previous.left === left && previous.width === width && previous.height === height
        ? previous : { top, left, width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    node.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); node.removeEventListener('scroll', measure) }
  }, [scrollRef])

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node || pointer.current !== undefined) return
    const left = cols.offset(active.col)
    const top = rows.offset(active.row)
    if (active.col > frozenCols && left < node.scrollLeft + frozenWidth) node.scrollLeft = Math.max(0, left - frozenWidth)
    else if (active.col > frozenCols && left + rowHeaderWidth + cols.size(active.col) > node.scrollLeft + node.clientWidth) {
      node.scrollLeft = cols.size(active.col) >= node.clientWidth - rowHeaderWidth - frozenWidth
        ? left - frozenWidth : left + rowHeaderWidth + cols.size(active.col) - node.clientWidth
    }
    if (active.row > frozenRows && top < node.scrollTop + frozenHeight) node.scrollTop = Math.max(0, top - frozenHeight)
    else if (active.row > frozenRows && top + columnHeaderHeight + rows.size(active.row) > node.scrollTop + node.clientHeight) {
      node.scrollTop = rows.size(active.row) >= node.clientHeight - columnHeaderHeight - frozenHeight
        ? top - frozenHeight : top + columnHeaderHeight + rows.size(active.row) - node.clientHeight
    }
  }, [active.row, active.col, cols, rows, frozenCols, frozenRows, frozenWidth, frozenHeight, scrollRef, sheet.id])

  useLayoutEffect(() => {
    if (!editing?.key) return
    input.current?.focus({ preventScroll: true })
    input.current?.setSelectionRange(input.current.value.length, input.current.value.length)
  }, [editing?.key])

  useLayoutEffect(() => {
    if (editorCursor && input.current) input.current.setSelectionRange(editorCursor.position, editorCursor.position)
  }, [editorCursor])

  const fixedRows = rows.visible(0, Math.min(frozenHeight, viewport.height))
  const fixedCols = cols.visible(0, Math.min(frozenWidth, viewport.width))
  const scrollingRows = rows.visible(Math.max(frozenHeight, viewport.top + frozenHeight - 72), viewport.top + viewport.height + 72)
  const scrollingCols = cols.visible(Math.max(frozenWidth, viewport.left + frozenWidth - 120), viewport.left + viewport.width + 120)
  const rowIndices = [...fixedRows, ...scrollingRows]
  const colIndices = [...fixedCols, ...scrollingCols]
  const visibleMerges = sheet.merges.filter(merge => rowIndices.some(row => row >= merge.row && row <= merge.endRow) &&
    colIndices.some(col => col >= merge.col && col <= merge.endCol))
  const mergesByRow = new Map<number, Range[]>()
  for (const row of rowIndices) mergesByRow.set(row, visibleMerges.filter(merge => row >= merge.row && row <= merge.endRow))
  const rowY = (row: number) => columnHeaderHeight + rows.offset(row) + (row <= frozenRows ? viewport.top : 0)
  const colX = (col: number) => rowHeaderWidth + cols.offset(col) + (col <= frozenCols ? viewport.left : 0)
  const frozenZ = (row: number, col: number) => (row <= frozenRows ? 2 : 0) + (col <= frozenCols ? 2 : 0)

  function renderCell(row: number, col: number, merge?: Range, detached = false) {
    const address = cellAddress(row, col)
    const cell = sheet.cells[address]
    const result = calculated?.[address]
    const selected = merge ? intersects(merge, range) : contains(range, row, col)
    const focused = address === activeAddress
    const endRow = merge?.endRow ?? row
    const endCol = merge?.endCol ?? col
    const look = conditional({ row, col }, cell, result)
    const display = displayCell(cell, locale, date1904, result)
    const width = cols.offset(endCol + 1) - cols.offset(col)
    const height = rows.offset(endRow + 1) - rows.offset(row)
    const style = cellStyle(cell?.style)
    const value = cell?.kind === 'formula' ? result ?? cell.cached : cell?.value
    const bar = look.bar !== undefined
    return <div id={'folio-cell-' + sheet.id + '-' + address} key={address} role="gridcell" aria-colindex={col + 1}
      aria-rowindex={row + 1} aria-rowspan={merge ? endRow - row + 1 : undefined}
      aria-colspan={merge ? endCol - col + 1 : undefined} aria-selected={selected} aria-label={address + (display ? ' ' + display : '')}
      className={['folio-sheet-cell', focused && 'is-active', selected && 'is-selected', merge && 'is-merged', cell?.link && 'has-link',
        cell?.kind === 'formula' && result === undefined && 'is-cached', cell?.style?.wrap && 'is-wrapped', header && row === 1 && 'is-csv-header'].filter(Boolean).join(' ')}
      data-row={row} data-col={col} data-address={address} data-top={selected && row <= range.row}
      data-bottom={selected && endRow >= range.endRow} data-left={selected && col <= range.col} data-right={selected && endCol >= range.endCol}
      style={{ ...style, left: colX(col), top: detached ? rowY(row) : 0, width, height, zIndex: frozenZ(row, col) + (merge ? 1 : 0),
        backgroundColor: !bar && look.color || cell?.style?.fill, color: cell?.style?.color ?? (!bar && look.color || cell?.style?.fill ? '#18241e' : undefined),
        textAlign: cell?.style?.horizontal ?? (typeof value === 'number' ? 'right' : undefined) }}
      title={cell?.link ? cell.link : cell?.kind === 'formula' ? String(cell.value) + (result === undefined ? ' · Stored or unavailable result' : '') : undefined}
      onDoubleClick={() => { if (!readOnly) onBeginEdit({ row, col }) }}
      onContextMenu={event => onContext(event, { row, col })}>
      {bar && <span className="folio-sheet-data-bar" aria-hidden="true" style={{ width: Math.max(2, (look.bar ?? 0) * 100) + '%', backgroundColor: look.color }} />}
      {editing && focused ? <textarea className="folio-sheet-cell-edit" aria-label={'Edit ' + address} ref={input} value={editorText(editing.value)} rows={1}
        aria-autocomplete={editorAssist ? 'list' : undefined} aria-controls={editorAssist?.expanded ? editorAssist.list : undefined}
        aria-activedescendant={editorAssist?.active}
        onChange={event => { onEdit(event.target.value); onEditorCursor?.(event.target) }} onBlur={() => onCommit()}
        onSelect={event => onEditorCursor?.(event.currentTarget)}
        onKeyDown={event => {
          event.stopPropagation()
          if (onEditorKey?.(event)) return
          if (event.key === 'Escape') { event.preventDefault(); onCancel() }
          if (event.key === 'Tab' || event.key === 'Enter' && !event.altKey) {
            event.preventDefault()
            onCommit(event.key === 'Enter' ? event.shiftKey ? 'up' : 'down' : event.shiftKey ? 'left' : 'right')
          }
        }} /> : <span className="folio-sheet-cell-text">{display}</span>}
    </div>
  }

  function pointerPoint(event: React.PointerEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-address]')
    if (cell) return parseAddress(cell.dataset.address ?? '')
    if (!scrollRef.current || !scrollRef.current.contains(event.target as Node)) return
    const box = scrollRef.current.getBoundingClientRect()
    const x = event.clientX - box.left - rowHeaderWidth
    const y = event.clientY - box.top - columnHeaderHeight
    if (x < 0 || y < 0 || event.clientX >= box.right || event.clientY >= box.bottom) return
    return { row: rows.index(y < frozenHeight ? y : y + viewport.top), col: cols.index(x < frozenWidth ? x : x + viewport.left) }
  }

  const resize = (event: React.PointerEvent, axis: 'row' | 'col', index: number) => {
    event.stopPropagation()
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    const start = axis === 'col' ? event.clientX : event.clientY
    const initial = (axis === 'col' ? cols : rows).size(index)
    const listener = (end: PointerEvent) => {
      if (end.type === 'pointerup') {
        const delta = (axis === 'col' ? end.clientX : end.clientY) - start
        if (Math.abs(delta) >= 2) onResize(axis, index, Math.min(1000, Math.max(axis === 'col' ? 24 : 16, Math.round(initial + delta))))
      }
      target.removeEventListener('pointerup', listener)
      target.removeEventListener('pointercancel', listener)
    }
    target.setPointerCapture(event.pointerId)
    target.addEventListener('pointerup', listener)
    target.addEventListener('pointercancel', listener)
  }

  return <div className="folio-sheet-scroll" role="grid" aria-label={sheet.name + ' worksheet'} aria-readonly={readOnly} tabIndex={0}
    aria-rowcount={spreadsheetLimits.rows + 1} aria-colcount={spreadsheetLimits.cols + 1}
    aria-activedescendant={rowIndices.includes(active.row) && colIndices.includes(active.col) ? 'folio-cell-' + sheet.id + '-' + activeAddress : undefined}
    ref={scrollRef} onKeyDown={onKey} onCopy={event => onCopy(event, false)} onCut={event => onCopy(event, true)} onPaste={onPaste}
    onPointerDown={event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('input, textarea, button, [role="columnheader"], [role="rowheader"]')) return
      const point = pointerPoint(event)
      if (!point) return
      event.preventDefault()
      if (editing) onCommit()
      pointer.current = event.pointerId
      scrollRef.current?.focus({ preventScroll: true })
      onSelect(point, event.shiftKey)
    }}
    onPointerMove={event => {
      if (pointer.current !== event.pointerId || (event.buttons & 1) === 0) { pointer.current = undefined; return }
      const point = pointerPoint(event)
      if (point) onSelect(point, true)
    }}
    onPointerUp={() => { pointer.current = undefined }}
    onPointerLeave={() => { pointer.current = undefined }}
    onPointerCancel={() => { pointer.current = undefined }}>
    <div className="folio-sheet-plane" data-grid-lines={sheet.gridLines}
      style={{ width: cols.total + rowHeaderWidth, height: rows.total + columnHeaderHeight }}>
      {rowIndices.map(row => <div className="folio-sheet-grid-row" role="row" aria-rowindex={row + 1} key={row}
        style={{ top: rowY(row), height: rows.size(row) }}>
        {colIndices.map(col => {
          const merge = mergesByRow.get(row)?.find(item => contains(item, row, col))
          if (merge && (row !== merge.row || col !== merge.col)) return null
          return renderCell(row, col, merge)
        })}
      </div>)}
      {visibleMerges.filter(merge => !rowIndices.includes(merge.row) || !colIndices.includes(merge.col))
        .map(merge => renderCell(merge.row, merge.col, merge, true))}
      <div className="folio-sheet-column-band" role="row" aria-rowindex={1}
        style={{ left: viewport.left, top: viewport.top, width: viewport.width, height: columnHeaderHeight }}>
        {colIndices.map(col => <div key={col} className="folio-sheet-coordinate" role="columnheader" aria-colindex={col + 1}
          data-selected={range.col <= col && col <= range.endCol} style={{ left: colX(col) - viewport.left, width: cols.size(col), height: columnHeaderHeight,
            zIndex: col <= frozenCols ? 1 : undefined }}
          onPointerDown={event => { if (event.button === 0) { scrollRef.current?.focus({ preventScroll: true }); onSelectAxis('col', col, event.shiftKey) } }}
          onContextMenu={event => onContext(event, { row: active.row, col }, 'col')}>
          <span>{columnName(col)}</span>
          {!readOnly && <span className="folio-sheet-resize col" title="Drag to resize. Double-click to fit contents."
            onPointerDown={event => resize(event, 'col', col)} onDoubleClick={event => { event.stopPropagation(); onAutoFit('col', col) }} />}
        </div>)}
      </div>
      <div className="folio-sheet-row-band" style={{ left: viewport.left, top: viewport.top, width: rowHeaderWidth, height: viewport.height }}>
        {rowIndices.map(row => <div key={row} className="folio-sheet-coordinate" role="rowheader" aria-rowindex={row + 1}
          data-selected={range.row <= row && row <= range.endRow}
          style={{ top: rowY(row) - viewport.top, width: rowHeaderWidth, height: rows.size(row), zIndex: row <= frozenRows ? 1 : undefined }}
          onPointerDown={event => { if (event.button === 0) { scrollRef.current?.focus({ preventScroll: true }); onSelectAxis('row', row, event.shiftKey) } }}
          onContextMenu={event => onContext(event, { row, col: active.col }, 'row')}>
          <span>{row}</span>
          {!readOnly && <span className="folio-sheet-resize row" title="Drag to resize. Double-click to fit contents."
            onPointerDown={event => resize(event, 'row', row)} onDoubleClick={event => { event.stopPropagation(); onAutoFit('row', row) }} />}
        </div>)}
      </div>
      <div className="folio-sheet-corner" aria-hidden="true" style={{ left: viewport.left, top: viewport.top, width: rowHeaderWidth, height: columnHeaderHeight }} />
    </div>
  </div>
}
