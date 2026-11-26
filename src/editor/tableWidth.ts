import type { Editor } from '@tiptap/core'
import { TableMap } from '@tiptap/pm/tables'

export const columnWidthStep = 24
export const columnWidthLimits = { min: 24, max: 2000 } as const

/** The table cell around the selection, its table and its first grid column. */
function selectedColumn(editor: Editor) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 2; depth--) {
    const cell = $from.node(depth)
    const role = cell.type.spec.tableRole
    if (role !== 'cell' && role !== 'header_cell') continue
    const table = $from.node(depth - 2)
    const tableStart = $from.start(depth - 2)
    const map = TableMap.get(table)
    const column = map.colCount($from.before(depth) - tableStart)
    return { cell, cellPos: $from.before(depth), table, tableStart, map, column }
  }
}

export function selectedColumnWidth(editor: Editor) {
  const selected = selectedColumn(editor)
  if (!selected) return
  const stored = selected.cell.attrs.colwidth?.[0]
  if (stored) return stored as number
  const dom = editor.view.nodeDOM(selected.cellPos)
  return dom instanceof HTMLElement ? Math.round(dom.getBoundingClientRect().width) : undefined
}

/**
 * Sets the selected column's width on every cell in that column as one undoable transaction, matching pointer
 * resizing. `null` returns the column to automatic sizing.
 */
export function setSelectedColumnWidth(editor: Editor, width: number | null) {
  const selected = selectedColumn(editor)
  if (!selected) return false
  const { table, tableStart, map, column } = selected
  const value = width === null ? null : Math.max(columnWidthLimits.min, Math.min(columnWidthLimits.max, Math.round(width)))
  const tr = editor.state.tr
  const seen = new Set<number>()
  for (let row = 0; row < map.height; row++) {
    const position = map.map[row * map.width + column]
    if (seen.has(position)) continue
    seen.add(position)
    const cell = table.nodeAt(position)
    if (!cell) continue
    const span: number = cell.attrs.colspan ?? 1
    const widths: number[] = cell.attrs.colwidth ? [...cell.attrs.colwidth] : Array(span).fill(0)
    widths[column - map.colCount(position)] = value ?? 0
    tr.setNodeMarkup(tableStart + position, undefined, { ...cell.attrs, colwidth: widths.every(item => !item) ? null : widths })
  }
  if (!tr.docChanged) return false
  editor.view.dispatch(tr)
  editor.commands.focus()
  return true
}

export function adjustSelectedColumnWidth(editor: Editor, delta: number) {
  const current = selectedColumnWidth(editor)
  return current !== undefined && setSelectedColumnWidth(editor, current + delta)
}
