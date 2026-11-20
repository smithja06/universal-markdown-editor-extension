import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Code2, Ellipsis, Highlighter,
  IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, ListTodo, Pilcrow, Plus, Redo2,
  Strikethrough, Underline, Undo2,
} from 'lucide-react'
import { IconButton, Menu, type Item } from './controls'

export const fontChoices = ['Default', 'Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New'] as const
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

const styles = ['Normal text', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6', 'Quote', 'Preformatted', 'Code block']
const fontName = (name?: string) => name === 'Inter Variable' ? 'Inter' : name ?? 'Inter'

function setParagraphAttribute(editor: Editor, key: string, value: string | null) {
  editor.chain().focus().updateAttributes(editor.isActive('heading') ? 'heading' : 'paragraph', { [key]: value }).run()
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

export function formatItems(editor: Editor, openLink: () => void): Item[] {
  return [
    { label: 'Superscript', active: editor.isActive('superscript'), run: () => editor.chain().focus().toggleSuperscript().run() },
    { label: 'Subscript', active: editor.isActive('subscript'), run: () => editor.chain().focus().toggleSubscript().run() },
    { label: 'Inline code', icon: <Code2 size={15} />, shortcut: 'Ctrl+E', active: editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    { label: 'Edit link', icon: <Link2 size={15} />, shortcut: 'Ctrl+K', run: openLink },
    { label: 'Remove link', disabled: !editor.isActive('link'), run: () => editor.chain().focus().extendMarkRange('link').unsetLink().run() },
    { label: '', divider: true },
    ...[1, 1.4, 1.7, 2].map(value => ({ label: 'Line spacing ' + value, run: () => setParagraphAttribute(editor, 'lineSpacing', String(value)) })),
    ...[0, 8, 16, 24].map(value => ({ label: 'Paragraph spacing ' + value + ' px', run: () => setParagraphAttribute(editor, 'paragraphSpacing', String(value) + 'px') })),
    { label: '', divider: true },
    { label: 'Increase indentation', icon: <IndentIncrease size={15} />, run: () => indent(editor, 1) },
    { label: 'Decrease indentation', icon: <IndentDecrease size={15} />, run: () => indent(editor, -1) },
    { label: 'Clear formatting', shortcut: 'Ctrl+\\', run: () => editor.chain().focus().unsetAllMarks().clearNodes().resetAttributes('paragraph', ['displayStyle', 'textAlign', 'lineSpacing', 'paragraphSpacing', 'indent']).run() },
  ]
}

export function tableItems(editor: Editor): Item[] {
  return [
    { label: 'Add row above', run: () => editor.chain().focus().addRowBefore().run() },
    { label: 'Add row below', run: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Add column before', run: () => editor.chain().focus().addColumnBefore().run() },
    { label: 'Add column after', run: () => editor.chain().focus().addColumnAfter().run() },
    { label: 'Toggle header row', run: () => editor.chain().focus().toggleHeaderRow().run() },
    ...alignments.slice(0, 3).map(([value, Icon]) => ({ label: 'Align cells ' + value, icon: <Icon size={15} />, run: () => editor.chain().focus().setCellAttribute('cellAlign', value).run() })),
    { label: 'Merge cells', disabled: !editor.can().mergeCells(), run: () => editor.chain().focus().mergeCells().run() },
    { label: 'Split cell', disabled: !editor.can().splitCell(), run: () => editor.chain().focus().splitCell().run() },
    { label: '', divider: true },
    { label: 'Delete row', run: () => editor.chain().focus().deleteRow().run() },
    { label: 'Delete column', run: () => editor.chain().focus().deleteColumn().run() },
    { label: 'Delete table', run: () => editor.chain().focus().deleteTable().run() },
  ]
}

export function fullFormatItems(editor: Editor, openLink: () => void): Item[] {
  return [
    { label: 'Bold', icon: <Bold size={15} />, shortcut: 'Ctrl+B', run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: <Italic size={15} />, shortcut: 'Ctrl+I', run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Underline', icon: <Underline size={15} />, shortcut: 'Ctrl+U', run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Strikethrough', icon: <Strikethrough size={15} />, run: () => editor.chain().focus().toggleStrike().run() },
    { label: '', divider: true },
    ...formatItems(editor, openLink),
  ]
}

export function Toolbar({ editor, source, ready, undo, redo, insertItems, openLink, sourceCanUndo, sourceCanRedo }: {
  editor: Editor | null; source: boolean; ready: boolean; undo(): void; redo(): void; insertItems: Item[]; openLink(): void; sourceCanUndo: boolean; sourceCanRedo: boolean
}) {
  const state = useFormatting(editor)
  const enabled = !!editor && !!state && ready && !source
  const active = (name: string) => state?.marks.includes(name) ?? false
  const CurrentAlign = alignments.find(([value]) => value === state?.alignment)?.[1] ?? AlignLeft
  const apply = (run: (current: Editor) => void) => () => { if (enabled) run(editor) }
  return <div className="toolbar" role="toolbar" aria-label={source ? 'Source controls' : 'Formatting controls'}>
    <div className="toolbar-group history-tools">
      <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!ready || (source ? !sourceCanUndo : !state?.undo)}><Undo2 size={17} /></IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!ready || (source ? !sourceCanRedo : !state?.redo)}><Redo2 size={17} /></IconButton>
    </div>
    {source ? <div className="source-toolbar-label"><Code2 size={16} /> Markdown source <span>Ctrl+F to find</span></div> : <>
      <div className="toolbar-group style-tools">
        <Menu label="Paragraph style" chevron disabled={!enabled} items={styles.map(label => ({ label, active: state?.style === label, run: apply(current => paragraphStyle(current, label)) }))}>
          <Pilcrow size={15} /><span>{state?.style ?? 'Normal text'}</span>
        </Menu>
      </div>
      <div className="toolbar-group type-tools">
        <Menu label="Font family" chevron disabled={!enabled} items={fontChoices.map(label => ({ label, active: (state?.text.fontFamily ? state.font : 'Default') === label, run: apply(current => { if (label === 'Default') current.chain().focus().unsetFontFamily().run(); else current.chain().focus().setFontFamily(label === 'Inter' ? 'Inter Variable' : label).run() }) }))}>
          <span>{state?.font ?? 'Inter'}</span>
        </Menu>
        <Menu label="Font size" chevron disabled={!enabled} items={[10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map(size => ({ label: String(size), active: state?.size === String(size), run: apply(current => current.chain().focus().setFontSize(String(size) + 'px').run()) }))}>
          <span>{state?.size ?? '16'}</span>
        </Menu>
      </div>
      <div className="toolbar-group mark-tools">
        <IconButton label="Bold (Ctrl+B)" active={active('bold')} disabled={!enabled} onClick={apply(current => current.chain().focus().toggleBold().run())}><Bold size={16} /></IconButton>
        <IconButton label="Italic (Ctrl+I)" active={active('italic')} disabled={!enabled} onClick={apply(current => current.chain().focus().toggleItalic().run())}><Italic size={16} /></IconButton>
        <IconButton label="Underline (Ctrl+U)" active={active('underline')} disabled={!enabled} onClick={apply(current => current.chain().focus().toggleUnderline().run())}><Underline size={16} /></IconButton>
        <IconButton label="Strikethrough" active={active('strike')} disabled={!enabled} onClick={apply(current => current.chain().focus().toggleStrike().run())}><Strikethrough size={16} /></IconButton>
        <Menu label="Text color" disabled={!enabled} items={[...colors.map(([label, value]) => ({ label, icon: colorDot(value), run: apply(current => current.chain().focus().setColor(value).run()) })), { label: 'Reset text color', run: apply(current => current.chain().focus().unsetColor().run()) }]}>
          <span className="color-letter" style={{ borderBottomColor: state?.text.color ?? 'currentColor' }}>A</span><ChevronDown size={10} />
        </Menu>
        <Menu label="Text highlight" className="highlight-tool" disabled={!enabled} items={[...highlights.map(([label, value]) => ({ label, icon: colorDot(value), run: apply(current => current.chain().focus().setBackgroundColor(value).run()) })), { label: 'Remove highlight', run: apply(current => current.chain().focus().unsetBackgroundColor().run()) }]}>
          <Highlighter size={17} /><ChevronDown size={10} />
        </Menu>
      </div>
      <div className="toolbar-group list-tools">
        <Menu label="Alignment" chevron disabled={!enabled} items={alignments.map(([value, Icon]) => ({ label: 'Align ' + value, icon: <Icon size={15} />, active: state?.alignment === value, run: apply(current => value === 'left' ? current.chain().focus().unsetTextAlign().run() : current.chain().focus().setTextAlign(value).run()) }))}><CurrentAlign size={17} /></Menu>
        <IconButton label="Bullet list" disabled={!enabled} active={active('bulletList')} onClick={apply(current => current.chain().focus().toggleBulletList().run())}><List size={18} /></IconButton>
        <IconButton label="Numbered list" disabled={!enabled} active={active('orderedList')} onClick={apply(current => current.chain().focus().toggleOrderedList().run())}><ListOrdered size={18} /></IconButton>
        <IconButton label="Task list" disabled={!enabled} active={active('taskList')} onClick={apply(current => current.chain().focus().toggleTaskList().run())}><ListTodo size={17} /></IconButton>
      </div>
      <div className="toolbar-group insert-tools">
        <IconButton label="Insert or edit link (Ctrl+K)" disabled={!enabled} active={active('link')} onClick={openLink}><Link2 size={17} /></IconButton>
        <Menu label="Insert content" align="right" chevron disabled={!enabled} items={insertItems}><Plus size={17} /></Menu>
        <Menu label="More formatting" align="right" disabled={!enabled} items={editor ? formatItems(editor, openLink) : []}><Ellipsis size={19} /></Menu>
      </div>
      {active('table') && editor && <div className="toolbar-group"><Menu label="Table controls" chevron items={tableItems(editor)}>Table</Menu></div>}
    </>}
  </div>
}
