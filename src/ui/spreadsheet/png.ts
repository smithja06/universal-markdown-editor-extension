import { cellAddress, rangeSize, spreadsheetLimits, type Border, type CellValue, type Range, type Sheet, type Workbook } from '../../document/formats/spreadsheet/model'
import { axisMetrics, contains, defaultHeight, defaultWidth, displayCell, ruleAppearance, wrapHeights } from './display'
import { fontFamily } from './Grid'

export const pngLimits = { side: 8192, pixels: 16_000_000 } as const

export async function renderRangePng(sheet: Sheet, workbook: Workbook, range: Range, calculated: Record<string, CellValue> | undefined,
  transparent: boolean, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted()
  if (rangeSize(range) > spreadsheetLimits.rangeCells) throw new Error('Select at most 20,000 cells for a PNG copy.')
  const cols = axisMetrics(spreadsheetLimits.cols, defaultWidth, sheet.widths, sheet.hiddenCols)
  const rows = axisMetrics(spreadsheetLimits.rows, defaultHeight, wrapHeights(sheet, workbook.locale, workbook.date1904), sheet.hiddenRows)
  const originX = cols.offset(range.col)
  const originY = rows.offset(range.row)
  const width = cols.offset(range.endCol + 1) - originX
  const height = rows.offset(range.endRow + 1) - originY
  if (!width || !height) throw new Error('Select a range with visible rows and columns.')
  if (width > pngLimits.side || height > pngLimits.side || width * height > pngLimits.pixels) {
    throw new Error('Select a smaller range. PNG copies are limited to 8,192 pixels per side and 16 million pixels.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('PNG rendering is unavailable.')
  if (!transparent) {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  const appearance = ruleAppearance(sheet, calculated)
  const merged = new Map<string, Range>()
  for (const merge of sheet.merges) {
    const startRow = Math.max(range.row, merge.row)
    const startCol = Math.max(range.col, merge.col)
    for (let row = startRow; row <= Math.min(range.endRow, merge.endRow); row++) {
      for (let col = startCol; col <= Math.min(range.endCol, merge.endCol); col++) merged.set(cellAddress(row, col), merge)
    }
  }
  const drawBorder = (border: Border | undefined, x1: number, y1: number, x2: number, y2: number) => {
    if (!border && !sheet.gridLines) return
    context.strokeStyle = border?.color ?? '#dfe5df'
    context.lineWidth = border?.style === 'thick' || border?.style === 'double' ? 3 : border?.style === 'medium' ? 2 : 1
    context.setLineDash(border?.style === 'dashed' ? [5, 3] : border?.style === 'dotted' ? [1, 2] : [])
    const draw = (x: number, y: number) => {
      context.beginPath()
      context.moveTo(x1 + x, y1 + y)
      context.lineTo(x2 + x, y2 + y)
      context.stroke()
    }
    if (border?.style === 'double') {
      context.lineWidth = 1
      draw(0, 0)
      draw(x1 === x2 ? (x1 === 0 ? 2 : -2) : 0, y1 === y2 ? (y1 === 0 ? 2 : -2) : 0)
    } else draw(0, 0)
    context.setLineDash([])
  }
  try {
    for (let row = range.row; row <= range.endRow; row++) {
      if ((row - range.row) % 32 === 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 0))
        signal?.throwIfAborted()
      }
      for (let col = range.col; col <= range.endCol; col++) {
        const merge = merged.get(cellAddress(row, col))
        if (merge && (row !== Math.max(range.row, merge.row) || col !== Math.max(range.col, merge.col))) continue
        const anchor = merge ?? { row, col }
        const endCol = Math.min(range.endCol, merge?.endCol ?? col)
        const endRow = Math.min(range.endRow, merge?.endRow ?? row)
        const x = cols.offset(col) - originX
        const y = rows.offset(row) - originY
        const w = cols.offset(endCol + 1) - cols.offset(col)
        const h = rows.offset(endRow + 1) - rows.offset(row)
        if (!w || !h) continue
        const address = cellAddress(anchor.row, anchor.col)
        const cell = sheet.cells[address]
        const style = cell?.style
        const result = calculated?.[address]
        const look = appearance(anchor, cell, result)
        const fill = look.bar === undefined ? look.color ?? style?.fill : style?.fill
        if (fill) {
          context.fillStyle = fill
          context.fillRect(x, y, w, h)
        }
        if (look.bar !== undefined && look.color) {
          context.fillStyle = look.color
          context.globalAlpha = .23
          context.fillRect(x + 1, y + 2, Math.max(2, (w - 2) * look.bar), Math.max(0, h - 4))
          context.globalAlpha = 1
        }
        drawBorder(style?.borders?.right, x + w - .5, y, x + w - .5, y + h)
        drawBorder(style?.borders?.bottom, x, y + h - .5, x + w, y + h - .5)
        if (style?.borders?.top) drawBorder(style.borders.top, x, y + .5, x + w, y + .5)
        if (style?.borders?.left) drawBorder(style.borders.left, x + .5, y, x + .5, y + h)
        if (merge && !contains(range, anchor.row, anchor.col)) continue
        const value = displayCell(cell, workbook.locale, workbook.date1904, result)
        if (!value) continue
        const fontSize = (style?.size ?? 11) * 4 / 3
        const lineHeight = fontSize * 1.3
        const alignment = style?.horizontal || (typeof (cell?.kind === 'formula' ? result ?? cell.cached : cell?.value) === 'number' ? 'right' : 'left')
        context.save()
        context.beginPath()
        context.rect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2))
        context.clip()
        context.font = (style?.italic ? 'italic ' : '') + (style?.bold ? '700 ' : '') + fontSize + 'px ' + (fontFamily(style?.font) ?? 'Arial, sans-serif')
        context.fillStyle = style?.color ?? (cell?.link ? '#18633d' : '#18241e')
        context.textBaseline = 'top'
        context.textAlign = alignment
        const textX = alignment === 'center' ? x + w / 2 : alignment === 'right' ? x + w - 5 : x + 5
        const maxLines = Math.min(300, Math.max(1, Math.floor((h - 4) / lineHeight)))
        const lines = style?.wrap ? wrapText(context, value, w - 10, maxLines) : [value.replace(/\s+/g, ' ')]
        const contentHeight = lines.length * lineHeight
        const textY = style?.vertical === 'top' ? y + 3 : style?.vertical === 'middle' ? y + (h - contentHeight) / 2 : y + h - contentHeight - 2
        lines.forEach((line, index) => {
          const lineY = textY + index * lineHeight
          context.fillText(line, textX, lineY)
          if (!style?.underline && !style?.strike && !cell?.link) return
          const textWidth = context.measureText(line).width
          const left = alignment === 'center' ? textX - textWidth / 2 : alignment === 'right' ? textX - textWidth : textX
          if (style?.underline || cell?.link) context.fillRect(left, lineY + fontSize, textWidth, 1)
          if (style?.strike) context.fillRect(left, lineY + fontSize * .56, textWidth, 1)
        })
        context.restore()
      }
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
      if (result) resolve(result)
      else reject(new Error('The PNG copy could not be generated.'))
    }, 'image/png'))
    signal?.throwIfAborted()
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    canvas.width = canvas.height = 1
  }
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number, limit: number) {
  const rows: string[] = []
  for (const line of text.split(/\r?\n/)) {
    let current = ''
    for (const word of line.split(' ')) {
      const joined = current ? current + ' ' + word : word
      if (current && context.measureText(joined).width > width) {
        rows.push(current)
        if (rows.length >= limit) return rows
        current = ''
      }
      if (context.measureText(word).width > width) {
        for (const glyph of word) {
          if (current && context.measureText(current + glyph).width > width) {
            rows.push(current)
            if (rows.length >= limit) return rows
            current = ''
          }
          current += glyph
        }
      } else current = current ? joined : word
    }
    rows.push(current)
    if (rows.length >= limit) break
  }
  return rows
}
