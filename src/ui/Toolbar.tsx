import type { Editor } from '@tiptap/core'
import { adjustSelectedColumnWidth, columnWidthStep, setSelectedColumnWidth } from '../editor/tableWidth'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Code2, Ellipsis, Highlighter,
  ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, ListTodo, Pilcrow, Plus, Redo2,
  Strikethrough, Underline, Undo2,
} from 'lucide-react'
import { IconButton, Menu, type Item } from './controls'

export const fontChoices = ['Default', 'Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New'] as const
/** Common Word fonts. They display when installed on this computer, and Word keeps them either way. */
const docxFontChoices = [...fontChoices.slice(0, 2), 'Aptos', 'Calibri', 'Cambria', ...fontChoices.slice(2)] as const
/** Word users choose sizes in points. Folio stores pixels, at 0.75 pt per pixel. */
const docxPointSizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]
const colors = [
  ['Ink', '#222d27'], ['Slate', '#546275'], ['Forest', '#16724f'], ['Ocean', '#2869a9'], ['Violet', '#7656a8'],
  ['Berry', '#a92f63'], ['Brick', '#b64339'], ['Amber', '#a95c13'],
]
const highlights = [['Lemon', '#fff0a5'], ['Mint', '#cdeed8'], ['Sky', '#d6e9ff'], ['Lilac', '#e9daff'], ['Rose', '#ffd8e2'], ['Peach', '#ffdfc3']]
const colorDot = (value: string) => <i className="color-dot" style={{ background: value }} />
const alignments = [['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const

export function paragraphStyle(editor: Editor, value: string) {
  const reset = { displayStyle: null }
  if (value === 'Title' || value === 'Subtitle') editor.chain().focus().setParagraph().updateAttributes('paragraph', { displayStyle: value.toLowerCase() }).run()
  else if (value.startsWith('Heading')) editor.chain().focus().setHeading({ level: Number(value.at(-1)) as 1 | 2 | 3 | 4 | 5 | 6 }).updateAttributes('heading', reset).run()
  else if (value === 'Quote') editor.chain().focus().toggleBlockquote().run()
  else if (value === 'Callout') editor.chain().focus().wrapIn('callout', { kind: 'note' }).run()
  else if (value === 'Code block') editor.chain().focus().setCodeBlock().run()
  else if (value === 'Preformatted') editor.chain().focus().setCodeBlock().updateAttributes('codeBlock', { language: 'text' }).run()
  else editor.chain().focus().setParagraph().updateAttributes('paragraph', reset).run()
}

const headingStyles = ['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6']
export const docxParagraphStyles = ['Normal text', ...headingStyles]
export const paragraphStyles = ['Normal text', 'Title', 'Subtitle', ...headingStyles, 'Quote', 'Preformatted', 'Code block']
const fontName = (name?: string) => name === 'Inter Variable' ? 'Inter' : name ?? 'Inter'

function setParagraphAttribute(editor: Editor, key: string, value: string | null) {
  editor.chain().focus().updateAttributes(editor.isActive('heading') ? 'heading' : 'paragraph', { [key]: value }).run()
}

/** DOCX lists have one level, so indentation applies to paragraphs and headings only. */
export function inList(editor: Editor) {
  return editor.isActive('listItem') || editor.isActive('taskItem')
}

export function indent(editor: Editor, direction: 1 | -1) {
  for (const node of ['taskItem', 'listItem']) {
    if (editor.isActive(node)) { editor.chain().focus()[direction === 1 ? 'sinkListItem' : 'liftListItem'](node).run(); return }
  }
  const type = editor.isActive('heading') ? 'heading' : 'paragraph'
  const current = Number.parseInt(editor.getAttributes(type).indent ?? '0', 10)
  const next = Math.min(144, Math.max(0, current + direction * 24))
  setParagraphAttribute(editor, 'indent', next ? String(next) + 'px' : null)
}

export function useFormatting(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: active }) => {
      if (!active) return null
      const heading = active.isActive('heading')
      const block = active.getAttributes(heading ? 'heading' : 'paragraph')
      const style = heading ? 'Heading ' + (block.level ?? 1)
        : block.displayStyle === 'title' ? 'Title' : block.displayStyle === 'subtitle' ? 'Subtitle'
          : active.isActive('codeBlock') ? 'Code block' : active.isActive('blockquote') ? 'Quote' : 'Normal text'
      const text = active.getAttributes('textStyle')
      const marks = ['bold', 'italic', 'underline', 'strike', 'code', 'superscript', 'subscript', 'link', 'bulletList', 'orderedList', 'taskList', 'table', 'image']
      return { style, alignment: block.textAlign ?? 'left', font: fontName(text.fontFamily), size: String(text.fontSize ?? '16px').replace('px', ''), text, marks: marks.filter(mark => active.isActive(mark)), undo: active.can().undo(), redo: active.can().redo() }
    },
  })
}

export function formatItems(editor: Editor, openLink: () => void, docx?: boolean): Item[] {
  const links = [
    { label: 'Edit link', icon: <Link2 size={15} />, shortcut: 'Ctrl+K', run: openLink },
    { label: 'Remove link', disabled: !editor.isActive('link'), run: () => editor.chain().focus().extendMarkRange('link').unsetLink().run() },
  ]
  const clear = { label: 'Clear formatting', shortcut: 'Ctrl+\\', run: () => editor.chain().focus().unsetAllMarks().clearNodes().resetAttributes('paragraph', ['displayStyle', 'textAlign', 'lineSpacing', 'paragraphSpacing', 'indent']).run() }
  const indentation = [
    { label: 'Increase indentation', icon: <IndentIncrease size={15} />, disabled: docx && inList(editor), run: () => indent(editor, 1) },
    { label: 'Decrease indentation', icon: <IndentDecrease size={15} />, disabled: docx && inList(editor), run: () => indent(editor, -1) },
  ]
  if (docx) return [...links, { label: '', divider: true }, ...indentation, clear]
  return [
    { label: 'Superscript', active: editor.isActive('superscript'), run: () => editor.chain().focus().toggleSuperscript().run() },
    { label: 'Subscript', active: editor.isActive('subscript'), run: () => editor.chain().focus().toggleSubscript().run() },
    { label: 'Inline code', icon: <Code2 size={15} />, shortcut: 'Ctrl+E', active: editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    ...links,
    { label: '', divider: true },
    ...[1, 1.4, 1.7, 2].map(value => ({ label: 'Line spacing ' + value, run: () => setParagraphAttribute(editor, 'lineSpacing', String(value)) })),
    ...[0, 8, 16, 24].map(value => ({ label: 'Paragraph spacing ' + value + ' px', run: () => setParagraphAttribute(editor, 'paragraphSpacing', String(value) + 'px') })),
    { label: '', divider: true },
    ...indentation,
    clear,
  ]
}

export function tableItems(editor: Editor, docx?: boolean): Item[] {
  const addColumn = (side: 'addColumnBefore' | 'addColumnAfter') => () => {
    const command = editor.chain().focus()[side]()
    if (docx && editor.isActive('tableHeader')) command.command(({ tr }) => {
      const { $from } = tr.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        const row = $from.node(depth)
        if (row.type.name !== 'tableRow') continue
        row.forEach((cell, offset) => {
          if (cell.type.name === 'tableCell') tr.setNodeMarkup($from.start(depth) + offset, editor.schema.nodes.tableHeader, cell.attrs)
        })
        break
      }
      return true
    })
    return command.run()
  }
  return [
    { label: 'Add row above', disabled: docx && editor.isActive('tableHeader'), run: () => editor.chain().focus().addRowBefore().run() },
    { label: 'Add row below', run: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Add column before', run: addColumn('addColumnBefore') },
    { label: 'Add column after', run: addColumn('addColumnAfter') },
    { label: 'Toggle header row', run: () => editor.chain().focus().toggleHeaderRow().run() },
    { label: '', divider: true },
    { label: `Widen column (+${columnWidthStep} px)`, run: () => adjustSelectedColumnWidth(editor, columnWidthStep) },
    { label: `Narrow column (−${columnWidthStep} px)`, run: () => adjustSelectedColumnWidth(editor, -columnWidthStep) },
    { label: 'Reset column width', run: () => setSelectedColumnWidth(editor, null) },
    ...(docx ? [] : [
      ...alignments.slice(0, 3).map(([value, Icon]) => ({ label: 'Align cells ' + value, icon: <Icon size={15} />, run: () => editor.chain().focus().setCellAttribute('cellAlign', value).run() })),
      { label: 'Merge cells', disabled: !editor.can().mergeCells(), run: () => editor.chain().focus().mergeCells().run() },
      { label: 'Split cell', disabled: !editor.can().splitCell(), run: () => editor.chain().focus().splitCell().run() },
    ]),
    { label: '', divider: true },
    { label: 'Delete row', run: () => editor.chain().focus().deleteRow().run() },
    { label: 'Delete column', run: () => editor.chain().focus().deleteColumn().run() },
    { label: 'Delete table', run: () => editor.chain().focus().deleteTable().run() },
  ]
}

export function fullFormatItems(editor: Editor, openLink: () => void, docx?: boolean): Item[] {
  return [
    { label: 'Bold', icon: <Bold size={15} />, shortcut: 'Ctrl+B', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: <Italic size={15} />, shortcut: 'Ctrl+I', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Underline', icon: <Underline size={15} />, shortcut: 'Ctrl+U', active: editor.isActive('underline'), run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Strikethrough', icon: <Strikethrough size={15} />, run: () => editor.chain().focus().toggleStrike().run() },
    { label: '', divider: true },
    ...formatItems(editor, openLink, docx),
  ]
}

export function Toolbar({ editor, state, source, plainText, docx, ready, execute, shortcut, insertItems, extraFormats, styleItems, sourceCanUndo, sourceCanRedo, sourceImageCommand, hostHistory }: {
  editor: Editor | null; source: boolean; plainText?: boolean; docx?: boolean; ready: boolean; execute(id: string): void; shortcut(id: string): string | undefined;
  state: ReturnType<typeof useFormatting>; insertItems: Item[]; extraFormats: Item[]; styleItems: Item[]; sourceCanUndo: boolean; sourceCanRedo: boolean; sourceImageCommand?: string; hostHistory?: boolean
}) {
  const enabled = !!editor && !!state && ready && !source
  const active = (name: string) => state?.marks.includes(name) ?? false
  const CurrentAlign = alignments.find(([value]) => value === state?.alignment)?.[1] ?? AlignLeft
  const paragraph = state?.style ?? 'Normal text'
  const family = state?.font ?? 'Inter'
  const pixelSize = state?.size ?? '16'
  const points = (pixels: string) => String(Number((Number.parseFloat(pixels) * 0.75).toFixed(1)))
  const fontSize = docx ? points(pixelSize) : pixelSize
  const apply = (run: (current: Editor) => void) => () => { if (enabled) run(editor) }
  const label = (name: string, id: string) => shortcut(id) ? `${name} (${shortcut(id)})` : name
  const fontFamilies = (docx ? docxFontChoices : fontChoices).map(label => ({
    label, active: (state?.text.fontFamily ? state.font : 'Default') === label,
    run: apply(current => {
      if (label === 'Default') current.chain().focus().unsetFontFamily().run()
      else current.chain().focus().setFontFamily(label === 'Inter' ? 'Inter Variable' : label).run()
    }),
  }))
  const fontSizes = docx
    ? docxPointSizes.map(size => ({
      label: String(size), active: fontSize === String(size),
      run: apply(current => current.chain().focus().setFontSize(Number((size / 0.75).toFixed(2)) + 'px').run()),
    }))
    : [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map(size => ({
      label: String(size), active: state?.size === String(size), run: apply(current => current.chain().focus().setFontSize(size + 'px').run()),
    }))
  const textColors = colors.map(([label, value]) => ({ label, icon: colorDot(value), run: apply(current => current.chain().focus().setColor(value).run()) }))
  const textHighlights = highlights.map(([label, value]) => ({ label, icon: colorDot(value), run: apply(current => current.chain().focus().setBackgroundColor(value).run()) }))
  const clearColor = { label: 'Reset text color', run: apply(current => current.chain().focus().unsetColor().run()) }
  const clearHighlight = { label: 'Remove highlight', run: apply(current => current.chain().focus().unsetBackgroundColor().run()) }
  const alignItems = alignments.map(([value, Icon]) => ({
    label: 'Align ' + value, icon: <Icon size={15} />, active: state?.alignment === value,
    run: apply(current => value === 'left' ? current.chain().focus().unsetTextAlign().run() : current.chain().focus().setTextAlign(value).run()),
  }))
  const table = !plainText && active('table') && editor ? tableItems(editor, docx) : []
  const lists = [
    { label: 'Bullet list', id: 'insert.bullet-list', mark: 'bulletList', Icon: List },
    { label: 'Numbered list', id: 'insert.numbered-list', mark: 'orderedList', Icon: ListOrdered },
    ...(docx ? [] : [{ label: 'Task list', id: 'insert.checklist', mark: 'taskList', Icon: ListTodo }]),
  ].map(({ label, id, mark, Icon }) => ({ label, active: active(mark), icon: <Icon size={16} />, run: () => execute(id) }))
  const strike = { label: 'Strikethrough', active: active('strike'), icon: <Strikethrough size={16} />, run: () => execute('format.strikethrough') }
  const divider = { label: '', divider: true }
  const compactFormats = [
    strike, ...lists, ...alignItems,
    ...(table.length ? [divider, ...table] : []),
    divider, ...fontFamilies.map(item => ({ ...item, label: 'Font family – ' + item.label })),
    ...fontSizes.map(item => ({ ...item, label: 'Font size – ' + item.label + (docx ? ' pt' : ' px') })),
    divider, ...textColors.map(item => ({ ...item, label: 'Text color – ' + item.label })), clearColor,
    ...textHighlights.map(item => ({ ...item, label: 'Text highlight – ' + item.label })), clearHighlight, divider,
  ]
  return <div className="toolbar" role="toolbar" aria-label={source ? 'Source controls' : 'Formatting controls'}>
    <div className="toolbar-group history-tools">
      <IconButton label={label('Undo', 'edit.undo')} onClick={() => execute('edit.undo')} disabled={!(hostHistory ?? (ready && (source ? sourceCanUndo : state?.undo)))}><Undo2 size={17} /></IconButton>
      <IconButton label={label('Redo', 'edit.redo')} onClick={() => execute('edit.redo')} disabled={!(hostHistory ?? (ready && (source ? sourceCanRedo : state?.redo)))}><Redo2 size={17} /></IconButton>
    </div>
    {source ? <>
      {sourceImageCommand && <div className="toolbar-group"><IconButton label="Insert image" disabled={!ready} onClick={() => execute(sourceImageCommand)}><ImagePlus size={17} /></IconButton></div>}
      <div className="source-toolbar-label"><Code2 size={16} /> {plainText ? 'Plain text' : 'Markdown source'} <span>{shortcut('search.find')} to find</span></div>
    </> : <>
      <div className="toolbar-group style-tools">
        <Menu label="Paragraph style" value={paragraph} chevron disabled={!enabled} items={styleItems.map(item => ({ ...item, active: state?.style === item.label }))}>
          <Pilcrow size={15} /><span>{paragraph}</span>
        </Menu>
      </div>
      <div className="toolbar-group type-tools wide-toolbar-tool">
        <Menu label="Font family" value={family} chevron disabled={!enabled} items={fontFamilies}>
          <span>{family}</span>
        </Menu>
        <Menu label={docx ? 'Font size in points' : 'Font size'} value={fontSize} chevron disabled={!enabled} items={fontSizes}>
          <span>{fontSize}</span>
        </Menu>
      </div>
      <div className="toolbar-group mark-tools">
        <IconButton label={label('Bold', 'format.bold')} active={active('bold')} disabled={!enabled} onClick={() => execute('format.bold')}><Bold size={16} /></IconButton>
        <IconButton label={label('Italic', 'format.italic')} active={active('italic')} disabled={!enabled} onClick={() => execute('format.italic')}><Italic size={16} /></IconButton>
        <IconButton label={label('Underline', 'format.underline')} active={active('underline')} disabled={!enabled} onClick={() => execute('format.underline')}><Underline size={16} /></IconButton>
          <IconButton label={strike.label} className="wide-toolbar-tool" active={strike.active} disabled={!enabled} onClick={strike.run}>{strike.icon}</IconButton>
          <Menu label="Text color" className="wide-toolbar-tool" disabled={!enabled} items={[...textColors, clearColor]}>
            <span className="color-letter" style={{ borderBottomColor: state?.text.color ?? 'currentColor' }}>A</span><ChevronDown size={10} />
          </Menu>
          <Menu label="Text highlight" className="wide-toolbar-tool" disabled={!enabled} items={[...textHighlights, clearHighlight]}>
            <Highlighter size={17} /><ChevronDown size={10} />
          </Menu>
      </div>
      <div className="toolbar-group list-tools wide-toolbar-tool">
        <Menu label="Alignment" chevron disabled={!enabled} items={alignItems}><CurrentAlign size={17} /></Menu>
        {lists.map(item => <IconButton key={item.label} label={item.label} disabled={!enabled} active={item.active} onClick={item.run}>{item.icon}</IconButton>)}
      </div>
      <div className="toolbar-group insert-tools">
        <IconButton label={label('Insert or edit link', 'format.edit-link')} className="wide-toolbar-tool" disabled={!enabled} active={active('link')} onClick={() => execute('format.edit-link')}><Link2 size={17} /></IconButton>
        <Menu label="Insert content" align="right" chevron disabled={!enabled} items={insertItems}><Plus size={17} /></Menu>
        <Menu label="More formatting" align="right" disabled={!enabled} items={extraFormats} compactItems={compactFormats}><Ellipsis size={19} /></Menu>
      </div>
      {table.length > 0 && <div className={docx ? 'toolbar-group' : 'toolbar-group wide-toolbar-tool'}><Menu label="Table controls" chevron disabled={!enabled} items={table}>Table</Menu></div>}
    </>}
  </div>
}
