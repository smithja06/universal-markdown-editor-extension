import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, ChevronDown, Eraser, Grid2X2, Italic, Layers3,
  Link2, Merge, Minus, PaintBucket, PaintRoller, Percent, Plus, Redo2, Rows3, Search, Strikethrough, Type, Underline, Undo2, WrapText } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CellStyle } from '../../document/formats/spreadsheet/model'
import { IconButton, Menu } from '../controls'
import { decimalFormat, formats } from './display'

export type ToolDialog = 'number' | 'fontColor' | 'fillColor' | 'border' | 'condition' | 'link'
export type BorderMode = 'all' | 'outside' | 'top' | 'right' | 'bottom' | 'left' | 'none'
type StyleUpdate = Partial<CellStyle> | ((style: CellStyle) => CellStyle)

const fontPresets = ['Default', 'Aptos', 'Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Consolas']
const presets: { label: string; style: CellStyle }[] = [
  { label: 'Title', style: { bold: true, size: 18, color: '#185641' } },
  { label: 'Heading', style: { bold: true, size: 12, fill: '#e3eee8', color: '#173c2e' } },
  { label: 'Emphasis', style: { italic: true, color: '#70481c', fill: '#fff0cc' } },
  { label: 'Total', style: { bold: true, numberFormat: '#,##0.00', borders: { top: { color: '#547465', style: 'medium' } } } },
  { label: 'Positive', style: { color: '#245c35', fill: '#e0efdc' } },
  { label: 'Attention', style: { color: '#8d2f37', fill: '#fce0df' } },
]

function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="folio-sheet-toolgroup" role="group" aria-label={label}>{children}</div>
}

export function SpreadsheetToolbar({ style, readOnly, canUndo, canRedo, undo, redo, stylePatch, clearStyles, clearValues,
  copyStyle, usableStyle, applyCopiedStyle, border, dialog, merge, unmerge, gridLines, toggleGrid, find, rangePng, currency }: {
  style: CellStyle; readOnly: boolean; canUndo: boolean; canRedo: boolean; undo(): void; redo(): void
  stylePatch: (update: StyleUpdate) => void; clearStyles(): void; clearValues(): void
  copyStyle(): void; usableStyle: boolean; applyCopiedStyle(): void; border: (mode: BorderMode) => void
  dialog: (name: ToolDialog) => void; merge: (center: boolean) => void; unmerge(): void; gridLines: boolean; toggleGrid(): void
  find(): void; rangePng(): void; currency: string
}) {
  const size = style.size ?? 11
  const setSize = (next: number) => { if (Number.isFinite(next)) stylePatch({ size: Math.min(96, Math.max(6, Math.round(next))) }) }
  const formatValue = style.numberFormat ?? 'General'
  const formatLabel = formats.find(([, value]) => value === formatValue)?.[0] ?? 'Custom'
  const marks = [
    ['bold', 'Bold', Bold], ['italic', 'Italic', Italic], ['underline', 'Underline', Underline], ['strike', 'Strikethrough', Strikethrough],
  ] as const
  const horizontal = [['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const
  return <div className="folio-sheet-tools" role="toolbar" aria-label="Spreadsheet formatting">
    <Group label="History">
      <IconButton label="Undo" disabled={!canUndo || readOnly} onClick={undo}><Undo2 size={17} /></IconButton>
      <IconButton label="Redo" disabled={!canRedo || readOnly} onClick={redo}><Redo2 size={17} /></IconButton>
    </Group>
    <Group label="Copy and clear">
      <Menu label="Format painter" disabled={readOnly} items={[
        { label: 'Copy styles', run: copyStyle },
        { label: 'Apply copied styles', disabled: !usableStyle, run: applyCopiedStyle },
      ]}><PaintRoller size={16} /><ChevronDown size={10} /></Menu>
      <Menu label="Clear cells" disabled={readOnly} items={[
        { label: 'Clear formatting', run: clearStyles }, { label: 'Clear values', run: clearValues },
      ]}><Eraser size={17} /><ChevronDown size={10} /></Menu>
    </Group>
    <Group label="Number format">
      <IconButton label="Currency" disabled={readOnly} onClick={() => stylePatch({ numberFormat: currency })}><span className="folio-sheet-tool-symbol">$</span></IconButton>
      <IconButton label="Percentage" disabled={readOnly} onClick={() => stylePatch({ numberFormat: '0.00%' })}><Percent size={16} /></IconButton>
      <IconButton label="Decrease decimal places" disabled={readOnly} onClick={() => stylePatch(s => ({ ...s, numberFormat: decimalFormat(s.numberFormat, -1) }))}><span className="folio-sheet-decimals">.0<small>←</small></span></IconButton>
      <IconButton label="Increase decimal places" disabled={readOnly} onClick={() => stylePatch(s => ({ ...s, numberFormat: decimalFormat(s.numberFormat, 1) }))}><span className="folio-sheet-decimals">.00<small>→</small></span></IconButton>
      <Menu label="Number format" value={formatLabel} disabled={readOnly} chevron items={[
        ...formats.map(([label, value]) => ({ label, active: value === formatValue, run: () => stylePatch({ numberFormat: value }) })),
        { divider: true, label: '' },
        { label: 'Custom format…', run: () => dialog('number') },
      ]}><span className="folio-sheet-tool-symbol">123</span></Menu>
    </Group>
    <Group label="Font size and face">
      <IconButton label="Decrease font size" disabled={readOnly || size <= 6} onClick={() => setSize(size - 1)}><Minus size={15} /></IconButton>
      <input className="folio-sheet-font-size" key={size} aria-label="Font size" title="Font size" type="number" inputMode="numeric"
        min={6} max={96} defaultValue={size} disabled={readOnly}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') { event.currentTarget.value = String(size); event.currentTarget.blur() }
        }}
        onBlur={event => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next) && next !== size) setSize(next) }} />
      <IconButton label="Increase font size" disabled={readOnly || size >= 96} onClick={() => setSize(size + 1)}><Plus size={15} /></IconButton>
      <Menu label="Font" value={style.font ?? 'Default'} disabled={readOnly} chevron items={fontPresets.map(font => ({
        label: font, active: font === (style.font ?? 'Default'), run: () => stylePatch({ font: font === 'Default' ? undefined : font }),
      }))}><span className="folio-sheet-font-face">{style.font ?? 'Font'}</span></Menu>
    </Group>
    <Group label="Text and colors">
      {marks.map(([key, label, Mark]) => <IconButton key={key} label={label} disabled={readOnly} active={!!style[key]} onClick={() => stylePatch({ [key]: !style[key] })}><Mark size={16} /></IconButton>)}
      <IconButton label="Font color" disabled={readOnly} onClick={() => dialog('fontColor')}><span className="folio-sheet-swatch" style={{ borderColor: style.color ?? 'currentColor' }}><Type size={16} /></span></IconButton>
      <IconButton label="Fill color" disabled={readOnly} onClick={() => dialog('fillColor')}><span className="folio-sheet-swatch" style={{ borderColor: style.fill ?? 'transparent' }}><PaintBucket size={16} /></span></IconButton>
      <Menu label="Cell borders" disabled={readOnly} items={[
        ...Object.entries({ all: 'All borders', outside: 'Outside borders', bottom: 'Bottom border', top: 'Top border', left: 'Left border', right: 'Right border', none: 'No borders' })
          .map(([key, label]) => ({ label, run: () => border(key as BorderMode) })),
        { divider: true, label: '' },
        { label: 'Border color and style…', run: () => dialog('border') },
      ]}><Grid2X2 size={17} /><ChevronDown size={10} /></Menu>
      <IconButton label="Conditional formatting" disabled={readOnly} onClick={() => dialog('condition')}><Rows3 size={17} /></IconButton>
      <Menu label="Cell styles and themes" disabled={readOnly} items={[
        ...presets.map(preset => ({ label: preset.label, run: () => stylePatch(preset.style) })),
        { divider: true, label: '' },
        { label: 'Forest palette', run: () => stylePatch({ color: '#1d5b43', fill: '#e1f0e6' }) },
        { label: 'Slate palette', run: () => stylePatch({ color: '#344258', fill: '#e7ecf4' }) },
        { label: 'Sand palette', run: () => stylePatch({ color: '#745020', fill: '#fff0d7' }) },
      ]}><Layers3 size={17} /><ChevronDown size={10} /></Menu>
    </Group>
    <Group label="Alignment and layout">
      {horizontal.map(([direction, Icon]) => <IconButton key={direction} label={'Align ' + direction} disabled={readOnly}
        active={style.horizontal === direction} onClick={() => stylePatch({ horizontal: direction })}><Icon size={16} /></IconButton>)}
      <Menu label="Vertical alignment" disabled={readOnly} items={[
        { label: 'Align top', active: style.vertical === 'top', run: () => stylePatch({ vertical: 'top' }) },
        { label: 'Align middle', active: style.vertical === 'middle', run: () => stylePatch({ vertical: 'middle' }) },
        { label: 'Align bottom', active: style.vertical === 'bottom', run: () => stylePatch({ vertical: 'bottom' }) },
      ]}>{style.vertical === 'top' ? <ArrowUpToLine size={16} /> : <ArrowDownToLine size={16} />}<ChevronDown size={10} /></Menu>
      <IconButton label="Wrap text" disabled={readOnly} active={!!style.wrap} onClick={() => stylePatch({ wrap: !style.wrap })}><WrapText size={17} /></IconButton>
      <Menu label="Merge cells" disabled={readOnly} items={[
        { label: 'Merge cells', run: () => merge(false) },
        { label: 'Merge and center', run: () => merge(true) },
        { label: 'Unmerge cells', run: unmerge },
      ]}><Merge size={17} /><ChevronDown size={10} /></Menu>
    </Group>
    <Group label="Worksheet tools">
      <IconButton label="Insert or edit link" disabled={readOnly} onClick={() => dialog('link')}><Link2 size={17} /></IconButton>
      <IconButton label={gridLines ? 'Hide grid lines' : 'Show grid lines'} active={gridLines} disabled={readOnly} onClick={toggleGrid}><Grid2X2 size={16} /></IconButton>
      <IconButton label="Find in workbook" onClick={find}><Search size={17} /></IconButton>
      <Menu label="Selection options" chevron items={[{ label: 'Export selected range as PNG…', run: rangePng }]}>Range</Menu>
    </Group>
  </div>
}
