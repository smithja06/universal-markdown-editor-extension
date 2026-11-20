import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { EditorContent } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { redo as redoSource, redoDepth, undo as undoSource, undoDepth } from '@codemirror/commands'
import {
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpRight, Braces, Check, ChevronDown, CircleAlert, CloudOff, Code2, Copy, Download, FileCode2,
  FilePlus2, FileText, FolderOpen, GitFork, Hash, History, ImagePlus, Info, Link2, List, ListOrdered, ListTodo, ListTree, LoaderCircle,
  Columns2, Link, Maximize2, Minimize2, Minus, PanelRight, Pilcrow, Quote, Redo2, Search, Sigma, Smile, Table2, Undo2, Upload, X,
} from 'lucide-react'
import { SourceEditor, type SourceLocation } from './editor/SourceEditor'
import { BlockHandle, blockDragType, dropPosition, hoveredBlock, moveBlock, moveSelectedBlock, type Grip } from './editor/BlockHandle'
import { useDocument, errorMessage } from './editor/useDocument'
import { dividerWidth, useSplitLayout } from './editor/useSplitLayout'
import { scrollToSplitHeading, useSplitScroll } from './editor/splitScroll'
import { calloutKinds } from './editor/schema'
import { useWorkspace, type EditorMode, type EditorPane } from './document/workspace'
import type { Heading } from './document/metadata'
import { IconButton, Menu, Modal, type Item } from './ui/controls'
import { Toolbar, fullFormatItems, paragraphStyle, paragraphStyles, useFormatting } from './ui/Toolbar'
import { Properties, type PropertyTab } from './ui/Properties'
import { InsertDialog, diagramPresets, type InsertRequest } from './ui/InsertDialog'
import { accentTheme } from './appearance'
import { VersionHistory } from './ui/VersionHistory'
import { DocumentLibrary } from './ui/DocumentLibrary'
import { DocumentTabs } from './ui/DocumentTabs'
import { CommandPalette, type PaletteEntry } from './ui/CommandPalette'
import { FindPanel, type FindPanelHandle } from './ui/FindPanel'
import { registerItems } from './ui/commandItems'
import { CommandRegistry, matchesShortcut, shortcutLabel } from './core/commands'
import { browserHost } from './host/browser'
import type { FolioHost } from './host/contracts'

const windowCommands = ['workspace.palette', 'document.save', 'document.save-as', 'document.open-markdown', 'search.find', 'search.replace',
  'search.next', 'search.previous', 'format.edit-link', 'format.clear-formatting', 'format.increase-indentation', 'format.decrease-indentation',
  'format.bold', 'format.italic', 'format.underline', 'format.inline-code']

const selectionCommands = new Set(windowCommands.filter(id => id.startsWith('format.')))

const fonts = {
  Default: 'Inter Variable, Inter, system-ui, sans-serif',
  'Sans serif': 'Arial, system-ui, sans-serif',
  Serif: 'Georgia, serif',
  Monospace: '"Cascadia Code", Consolas, monospace',
}

interface SlashState { from: number; to: number; word: string; left: number; top: number }

const editorModes = [
  { mode: 'visual', label: 'Visual Editor', short: 'Visual', icon: Pilcrow },
  { mode: 'source', label: 'Markdown Source', short: 'Markdown', icon: Code2 },
  { mode: 'split', label: 'Split Editor', short: 'Split', icon: Columns2 },
] satisfies { mode: EditorMode; label: string; short: string; icon: typeof Code2 }[]

export default function App({ host = browserHost }: { host?: FolioHost } = {}) {
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const notify = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 4300)
  }, [])
  const visualScroll = useRef<HTMLDivElement>(null)
  const doc = useDocument(notify, visualScroll, host)
  const { editor } = doc
  const formatting = useFormatting(editor)
  const { mode, sidebar, setSidebar, appearance, setAppearance } = useWorkspace()
  const accents = useMemo(() => accentTheme(appearance.accentColor, appearance.theme), [appearance.accentColor, appearance.theme])
  const split = mode === 'split'
  const source = mode === 'source' || (split && doc.activePane === 'source')
  const started = !!editor && doc.status !== 'loading'
  const ready = started && !!doc.layout.activeId
  const editable = ready && (source || !doc.previewIssue)
  const splitLayout = useSplitLayout(appearance.splitRatio, ratio => setAppearance({ splitRatio: ratio }))
  useSplitScroll(split && ready && appearance.syncScroll && !doc.previewIssue, editor, visualScroll, doc.sourceView, doc.scrollAnchors, doc.file.id)
  const [tab, setTab] = useState<PropertyTab>('Outline')
  const [width, setWidth] = useState(304)
  const [location, setLocation] = useState<SourceLocation>({ line: 1, column: 1 })
  const [request, setRequest] = useState<InsertRequest | null>(null)
  const [dialog, setDialog] = useState<'shortcuts' | 'recent' | 'history' | 'library' | 'emoji' | null>(null)
  const [palette, setPalette] = useState<'all' | 'documents' | 'headings' | null>(null)
  const [recentCommands, setRecentCommands] = useState(() => host.recentCommands.read())
  const [findPanel, setFindPanel] = useState<{ replace: boolean } | null>(null)
  const findRef = useRef<FindPanelHandle>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [grip, setGrip] = useState<Grip | null>(null)
  const draggedBlock = useRef<number | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const editorIdentity = useRef('')
  editorIdentity.current = doc.file.id + ':' + doc.editorEpoch
  const undoAvailable = doc.sourceView.current ? undoDepth(doc.sourceView.current.state) > 0 : false
  const redoAvailable = doc.sourceView.current ? redoDepth(doc.sourceView.current.state) > 0 : false
  const registry = new CommandRegistry()
  const commandRef = useRef(registry)
  commandRef.current = registry
  const platform = host.keyboard.platform
  const execute = (id: string, argument?: string) => {
    try { registry.execute(id, argument) } catch (error) { notify(errorMessage(error)) }
  }
  const commandShortcut = (id: string) => {
    const binding = registry.get(id)?.shortcuts?.find(item => !item.platform || item.platform === platform)
    return binding ? shortcutLabel(binding, platform) : undefined
  }

  useEffect(() => {
    draggedBlock.current = undefined
    setGrip(null)
    setSlash(null)
  }, [doc.editorEpoch])

  const report = (operation: Promise<void>) => { void operation.catch(error => notify(errorMessage(error))) }

  function newFile() {
    try { doc.createDocument(); requestAnimationFrame(() => editor?.commands.focus()) }
    catch (error) { notify(errorMessage(error)) }
  }

  function openLink(preset?: string) { if (!source && doc.activatePane('visual')) setRequest({ name: 'link', preset }) }
  function showSearch(replace = false) {
    if (!ready) return
    if (findRef.current) findRef.current.focus(replace)
    else setFindPanel({ replace })
  }
  function closeSearch() {
    setFindPanel(null)
    if (source) doc.sourceView.current?.focus()
    else editor?.view.focus()
  }
  function undo() {
    if (!doc.activatePane(source ? 'source' : 'visual')) return
    if (source && doc.sourceView.current) { undoSource(doc.sourceView.current); doc.sourceView.current.focus() }
    else editor?.chain().focus().undo().run()
  }
  function redo() {
    if (!doc.activatePane(source ? 'source' : 'visual')) return
    if (source && doc.sourceView.current) { redoSource(doc.sourceView.current); doc.sourceView.current.focus() }
    else editor?.chain().focus().redo().run()
  }
  function openProperties(next: PropertyTab) { setTab(next); setSidebar(true) }
  function jump(heading: Heading) {
    const position = doc.jumpToHeading(heading)
    const view = doc.sourceView.current
    if (position && editor && view && visualScroll.current) scrollToSplitHeading(editor, visualScroll.current, view, position)
  }
  function addNode(type: string, attrs?: Record<string, unknown>) { editor?.chain().focus().insertContent({ type, attrs }).run() }
  const insert = (name: InsertRequest['name'], preset?: string) => () => setRequest({ name, preset })
  const actions = registerItems(registry, platform, 'Insert', 'insert', [
    { label: 'Paragraph', icon: <Pilcrow size={16} />, run: () => editor?.chain().focus().setParagraph().run() },
    { label: 'Heading', icon: <Hash size={16} />, run: () => editor && paragraphStyle(editor, 'Heading 2') },
    { label: 'Quote', icon: <Quote size={16} />, run: () => editor?.chain().focus().toggleBlockquote().run() },
    { label: 'Divider', icon: <Minus size={16} />, run: () => editor?.chain().focus().setHorizontalRule().run() },
    { label: 'Code block', icon: <Code2 size={16} />, run: () => editor?.chain().focus().toggleCodeBlock().run() },
    { label: 'Bullet list', icon: <List size={16} />, run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', icon: <ListOrdered size={16} />, run: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: 'Checklist', keywords: 'task list', icon: <ListTodo size={16} />, run: () => editor?.chain().focus().toggleTaskList().run() },
    { label: '', divider: true },
    ...calloutKinds.map(kind => ({
      label: kind[0].toUpperCase() + kind.slice(1) + ' callout', icon: <Info size={16} />,
      run: () => editor?.chain().focus().wrapIn('callout', { kind }).run(),
    })),
    { label: '', divider: true },
    { label: 'Image or image caption', icon: <ImagePlus size={16} />, run: insert('image') },
    { label: 'Image from file', icon: <Upload size={16} />, run: () => imageInput.current?.click() },
    { label: 'Emoji', icon: <Smile size={16} />, run: () => setDialog('emoji') },
    { label: 'Hyperlink', icon: <Link2 size={16} />, run: () => openLink() },
    { label: 'Media link', icon: <ArrowUpRight size={16} />, run: () => openLink('https://') },
    { label: 'File link', icon: <FileText size={16} />, run: () => openLink('./') },
    { label: 'Heading anchor', icon: <Hash size={16} />, run: () => openLink(doc.info.outline[0] ? '#' + doc.info.outline[0].anchor : '#') },
    { label: 'Wiki link', icon: <Link2 size={16} />, run: insert('wikiLink') },
    { label: 'Footnote', icon: <Braces size={16} />, run: insert('footnote') },
    { label: 'Reference link', icon: <Link2 size={16} />, run: insert('reference') },
    { label: 'Table of contents', icon: <ListTree size={16} />, run: () => addNode('toc') },
    { label: '', divider: true },
    { label: 'Table', icon: <Table2 size={16} />, run: insert('table') },
    { label: 'Mermaid diagram', icon: <GitFork size={16} />, run: insert('mermaid', diagramPresets.Flowchart) },
    { label: 'Inline equation', icon: <Sigma size={16} />, run: insert('inlineMath') },
    { label: 'Block equation', icon: <Braces size={16} />, run: insert('blockMath') },
  ], editable && !source)

  const slashItems = slash ? actions.filter(item => !item.divider && item.label.toLowerCase().includes(slash.word)).slice(0, 11) : []
  const runSlash = (item: Item) => {
    if (!editor || !slash) return
    editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run()
    setSlash(null)
    item.run?.()
  }

  useEffect(() => {
    if (!editor || source) return
    let dismissed = ''
    const update = () => {
      const { selection } = editor.state
      if (!selection.empty || selection.$from.parent.type.name !== 'paragraph' || !editor.view.hasFocus()) { setSlash(null); dismissed = ''; return }
      const word = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '', '\uFFFC')
      if (!/^\/[a-zA-Z -]*$/.test(word)) { setSlash(null); dismissed = ''; return }
      const position = editor.view.coordsAtPos(selection.from)
      const from = selection.from - word.length
      const key = from + word
      if (dismissed === key) return
      setSlash(previous => {
        if (previous?.word === word.slice(1).toLowerCase() && previous?.from === from) return previous
        return { from, to: selection.from, word: word.slice(1).toLowerCase(), left: Math.max(8, Math.min(position.left, window.innerWidth - 285)), top: Math.max(8, Math.min(position.bottom + 7, window.innerHeight - 285)) }
      })
      setSlashIndex(0)
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const selected = editor.state.selection.$from
      const word = selected.parent.textBetween(0, selected.parentOffset)
      if (!word.startsWith('/')) return
      dismissed = (selected.pos - word.length) + word
      setSlash(null)
    }
    editor.on('transaction', update)
    editor.view.dom.addEventListener('keydown', dismiss, true)
    return () => { editor.off('transaction', update); editor.view.dom.removeEventListener('keydown', dismiss, true); setSlash(null) }
  }, [editor, source, editable])

  useEffect(() => {
    if (!editor || !slash || !slashItems.length) return
    const handle = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Enter') runSlash(slashItems[slashIndex % slashItems.length])
      else setSlashIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % slashItems.length)
    }
    editor.view.dom.addEventListener('keydown', handle, true)
    return () => editor.view.dom.removeEventListener('keydown', handle, true)
  })

  useEffect(() => {
    if (!editor) return
    const element = editor.view.dom
    const edit = (event: Event) => { if (doc.activatePane('visual')) setRequest((event as CustomEvent<InsertRequest>).detail) }
    const openSource = () => {
      if (split && doc.activatePane('source')) doc.sourceView.current?.focus()
      else doc.switchMode('source')
    }
    const anchor = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]')
      const destination = link?.getAttribute('href')?.slice(1)
      const heading = doc.info.outline.find(item => item.anchor === destination)
      if (heading) { event.preventDefault(); jump(heading) }
    }
    const editImage = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLImageElement) || !doc.activatePane('visual')) return
      const image = event.target.closest('[data-folio-image]') ?? event.target
      const position = editor.view.posAtDOM(image, 0)
      if (editor.state.doc.nodeAt(position)?.type.name === 'image') {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))
        setRequest({ name: 'image', position })
      }
    }
    element.addEventListener('folio-edit-atom', edit)
    element.addEventListener('folio-open-source', openSource)
    element.addEventListener('click', anchor)
    element.addEventListener('dblclick', editImage)
    return () => { element.removeEventListener('folio-edit-atom', edit); element.removeEventListener('folio-open-source', openSource); element.removeEventListener('click', anchor); element.removeEventListener('dblclick', editImage) }
  })

  async function addImage(file: File, position?: number, target: EditorPane = doc.activePane) {
    const activeEditor = editorIdentity.current
    try {
      const asset = await host.files.addAttachment(file)
      if (!editor || activeEditor !== editorIdentity.current || !doc.activatePane(target)) return
      if (target === 'source') {
        const view = doc.sourceView.current
        if (!view) return
        const { from, to } = view.state.selection.main
        const alt = asset.alt.replace(/[\[\]\\]/g, ' ')
        const text = '![' + alt + '](' + asset.url + ')'
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
        view.focus()
      } else {
        const attrs = { type: 'image', attrs: { src: asset.url, alt: asset.alt } }
        const command = editor.chain().focus()
        if (position !== undefined) command.insertContentAt(Math.min(position, editor.state.doc.content.size), attrs).run()
        else if (editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === 'image') command.updateAttributes('image', { src: asset.url }).run()
        else command.insertContent(attrs).run()
      }
    } catch (error) { notify(errorMessage(error)) }
  }

  function acceptDrop(event: DragEvent) {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    titleInput.current?.blur()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    const markdown = files.find(file => /\.(md|markdown)$/i.test(file.name))
    if (markdown) { void doc.importFile(markdown); return }
    const image = files.find(file => /^image\//i.test(file.type))
    const target = mode === 'source' || (split && (event.target as Element).closest('.source-shell')) ? 'source' : 'visual'
    const point = target === 'visual' ? editor?.view.posAtCoords({ left: event.clientX, top: event.clientY }) : undefined
    if (image) void addImage(image, point?.pos, target)
    else notify('Drop a Markdown document or an image file.')
  }

  function dropBlock(event: DragEvent) {
    if (!editor || draggedBlock.current === undefined || !event.dataTransfer.types.includes(blockDragType)) return
    event.preventDefault()
    event.stopPropagation()
    const from = draggedBlock.current
    draggedBlock.current = undefined
    setGrip(null)
    const destination = dropPosition(editor, event.clientX, event.clientY)
    if (destination !== undefined && doc.activatePane('visual')) moveBlock(editor, from, destination)
  }

  async function copy(kind: 'markdown' | 'text') {
    try {
      const current = doc.project()
      if (kind === 'markdown') await navigator.clipboard.writeText(current.source)
      else if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const text = import('./document/export').then(({ renderedText }) => new Blob([renderedText(current.source)], { type: 'text/plain' }))
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })])
      } else {
        const { renderedText } = await import('./document/export')
        await navigator.clipboard.writeText(renderedText(current.source))
      }
      notify(kind === 'markdown' ? 'Markdown copied' : 'Rendered text copied')
    } catch (error) { notify('Could not copy to the clipboard. ' + errorMessage(error)) }
  }

  const fileItems = registerItems(registry, platform, 'Document', 'document', [
    { label: 'New document', icon: <FilePlus2 size={16} />, run: newFile },
    { label: 'Open Markdown…', icon: <FolderOpen size={16} />, shortcut: 'Ctrl+O', run: () => fileInput.current?.click() },
    { label: 'Document library', icon: <FolderOpen size={16} />, run: () => setDialog('library') },
    { label: 'Recent documents', icon: <FileText size={16} />, run: () => setDialog('recent') },
    { label: 'Version History', icon: <History size={16} />, disabled: !ready, run: () => setDialog('history') },
    { label: '', divider: true },
    { label: 'Save', icon: <Download size={16} />, shortcut: 'Ctrl+S', disabled: !ready, run: () => void doc.save() },
    { label: 'Save as…', icon: <ArrowDownToLine size={16} />, shortcut: 'Ctrl+Shift+S', disabled: !ready, run: () => void doc.save({ saveAs: true }) },
    { label: '', divider: true },
    { label: 'Rename document', disabled: !ready, run: () => requestAnimationFrame(() => { titleInput.current?.focus(); titleInput.current?.select() }) },
    { label: 'Duplicate document', disabled: !ready, run: () => report(doc.duplicateDocument(doc.file.id)) },
  ], started)
  const editItems = registerItems(registry, platform, 'Editing', 'edit', [
    { label: 'Undo', icon: <Undo2 size={16} />, shortcut: 'Ctrl+Z', run: undo, disabled: source ? !undoAvailable : !formatting?.undo,
      available: () => ready && (source ? !!doc.sourceView.current && undoDepth(doc.sourceView.current.state) > 0 : !!editor?.can().undo()) },
    { label: 'Redo', icon: <Redo2 size={16} />, shortcut: 'Ctrl+Shift+Z', run: redo, disabled: source ? !redoAvailable : !formatting?.redo,
      available: () => ready && (source ? !!doc.sourceView.current && redoDepth(doc.sourceView.current.state) > 0 : !!editor?.can().redo()) },
    { label: '', divider: true },
    { id: 'search.find', label: 'Find and replace', keywords: 'search text match', icon: <Search size={16} />, shortcut: 'Ctrl+F', disabled: !ready, run: () => showSearch() },
    { id: 'workspace.palette', label: 'Command Palette', shortcut: 'Ctrl+Shift+P', run: () => setPalette(previous => previous ? null : 'all') },
    { label: 'Move block up', icon: <ArrowUp size={16} />, disabled: source || !editable, run: () => editor && moveSelectedBlock(editor, -1) },
    { label: 'Move block down', icon: <ArrowDown size={16} />, disabled: source || !editable, run: () => editor && moveSelectedBlock(editor, 1) },
    { label: 'Keyboard shortcuts', run: () => setDialog('shortcuts') },
  ], started)
  const viewItems = registerItems(registry, platform, 'View', 'view', [
    ...editorModes.map(({ mode: choice, label, icon: Icon }) => ({ id: 'view.mode.' + choice, label, keywords: 'switch editor mode ' + choice, icon: <Icon size={16} />, active: mode === choice, run: () => doc.switchMode(choice) })),
    ...(split ? [{ label: 'Sync Scroll', active: appearance.syncScroll, run: () => setAppearance({ syncScroll: !appearance.syncScroll }) }] : []),
    { id: 'view.properties', label: sidebar ? 'Hide document properties' : 'Show document properties', keywords: 'toggle sidebar', icon: <PanelRight size={16} />, run: () => setSidebar(!sidebar) },
    { label: 'Document outline', icon: <ListTree size={16} />, run: () => openProperties('Outline') },
    { id: 'view.width', label: appearance.width === 'full' ? 'Page width' : 'Full width', keywords: 'toggle document width', icon: appearance.width === 'full' ? <Minimize2 size={16} /> : <Maximize2 size={16} />, run: () => setAppearance({ width: appearance.width === 'full' ? 'page' : 'full' }) },
    { label: 'Appearance', run: () => openProperties('Appearance') },
    { label: 'Statistics', run: () => openProperties('Statistics') },
  ], ready)
  const downloadHtml = async (selfContained: boolean) => {
    try {
      const current = doc.project()
      const { exportHtml } = await import('./document/export')
      const { failedDiagrams, unavailableImages } = await exportHtml(current.title, current.source, selfContained, {
        fontFamily: fonts[appearance.font], fontSize: appearance.fontSize, lineHeight: appearance.lineHeight,
      }, host.files.download)
      const notices = [
        failedDiagrams ? `${failedDiagrams} diagram${failedDiagrams === 1 ? '' : 's'} kept as source` : '',
        unavailableImages ? `${unavailableImages} image${unavailableImages === 1 ? '' : 's'} unavailable` : '',
      ].filter(Boolean)
      notify(notices.length ? `HTML download started with ${notices.join(' and ')}` : 'HTML download started')
    } catch (error) { notify(errorMessage(error)) }
  }
  const exportItems = registerItems(registry, platform, 'Export', 'export', [
    { label: 'Download Markdown', icon: <ArrowDownToLine size={16} />, run: () => void doc.save({ download: true }) },
    { label: 'Export HTML', icon: <FileCode2 size={16} />, run: () => void downloadHtml(false) },
    { label: 'Self-Contained HTML', icon: <FileCode2 size={16} />, run: () => void downloadHtml(true) },
    { label: '', divider: true },
    { label: 'Copy Markdown', icon: <Copy size={16} />, run: () => void copy('markdown') },
    { label: 'Copy rendered text', icon: <Copy size={16} />, run: () => void copy('text') },
  ], ready)

  const formatMenu = registerItems(registry, platform, 'Formatting', 'format', editor ? fullFormatItems(editor, () => openLink()).map(item => ({
    ...item, shortcut: item.label === 'Increase indentation' ? 'Ctrl+]' : item.label === 'Decrease indentation' ? 'Ctrl+[' : item.shortcut,
  })) : [], editable && !source)
  const styleItems = registerItems(registry, platform, 'Formatting', 'style', paragraphStyles.map(label => ({
    label, run: () => { if (editor) paragraphStyle(editor, label) }, keywords: 'paragraph style',
  })), editable && !source)

  registry.register({ id: 'search.replace', label: 'Replace text', category: 'Editing', available: () => ready,
    shortcuts: [{ key: 'h', primary: true, platform: 'other' }, { key: 'f', primary: true, alt: true, platform: 'mac' }], run: () => showSearch(true) })
  registry.register({ id: 'search.next', label: 'Find next match', category: 'Editing', available: () => !!findPanel && ready,
    shortcuts: [{ key: 'F3' }], run: () => findRef.current?.move(1) })
  registry.register({ id: 'search.previous', label: 'Find previous match', category: 'Editing', available: () => !!findPanel && ready,
    shortcuts: [{ key: 'F3', shift: true }], run: () => findRef.current?.move(-1) })
  registry.register({ id: 'navigation.documents', label: 'Switch document', category: 'Navigation', keywords: 'open tab library recent',
    available: () => started, run: () => setPalette('documents') })
  registry.register({ id: 'navigation.headings', label: 'Go to heading', category: 'Navigation', keywords: 'outline jump section',
    available: () => ready && doc.info.outline.length > 0, run: () => setPalette('headings') })
  registry.register({ id: 'navigation.open-document', label: 'Open saved document', category: 'Navigation',
    available: () => started, run: id => { if (id) report(doc.openDocument(id)); else setPalette('documents') } })
  registry.register({ id: 'navigation.jump', label: 'Jump to section', category: 'Navigation', keywords: 'heading outline',
    available: () => ready && doc.info.outline.length > 0, run: anchor => {
      const heading = doc.info.outline.find(item => item.anchor === anchor)
      if (heading) requestAnimationFrame(() => jump(heading))
      else setPalette('headings')
    } })

  useEffect(() => host.commands?.attach({
    commands: () => commandRef.current.list(),
    execute: (id, argument) => commandRef.current.execute(id, argument),
  }), [host.commands])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || request || dialog) return
      for (const id of windowCommands) {
        if ((palette && id !== 'workspace.palette') || host.keyboard.handledByHost?.has(id)) continue
        if (selectionCommands.has(id) && (!editor?.isFocused || source)) continue
        const command = registry.get(id)
        if (!command?.shortcuts?.some(shortcut => matchesShortcut(shortcut, event, platform)) || command.available?.() === false) continue
        event.preventDefault()
        event.stopPropagation()
        execute(id)
        return
      }
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  })

  function paletteEntries(): PaletteEntry[] {
    const open = new Set(doc.tabs.map(item => item.id))
    const documents = doc.library.filter(item => item.deletedAt === undefined).slice().sort((left, right) => Number(open.has(right.id)) - Number(open.has(left.id)) || (right.openedAt ?? right.updated) - (left.openedAt ?? left.updated))
    const documentEntries = documents.map(item => ({ key: 'doc:' + item.id, id: 'navigation.open-document', argument: item.id, label: item.title,
      category: open.has(item.id) ? 'Open tabs' : 'Library', keywords: 'open switch document', hint: open.has(item.id) ? 'Open tab' : 'Library document' }))
    const headings = doc.info.outline.map(heading => ({ key: `heading:${doc.file.id}:${heading.anchor}`, id: 'navigation.jump', argument: heading.anchor,
      label: heading.title, category: 'Headings', keywords: 'jump heading', hint: `H${heading.level}` }))
    if (palette === 'documents') return documentEntries
    if (palette === 'headings') return headings
    const commands = registry.list().filter(command => command.available?.() !== false && !['navigation.open-document', 'navigation.jump'].includes(command.id))
    return [...commands.map(command => ({ key: command.id, id: command.id, label: command.label, category: command.category, keywords: command.keywords,
      shortcut: commandShortcut(command.id) })), ...documentEntries, ...headings]
  }

  function runPalette(entry: PaletteEntry) {
    const recent = [entry.key, ...recentCommands.filter(id => id !== entry.key)].slice(0, 12)
    setRecentCommands(recent)
    host.recentCommands.write(recent)
    setPalette(null)
    execute(entry.id, entry.argument)
  }

  const shortcutRows = registry.list().flatMap(command => {
    const label = commandShortcut(command.id)
    return label ? [[command.label, label]] : []
  }).concat([['Insert menu', '/ on an empty line'], ['Indent list item', 'Tab']])

  const statusLabel = doc.status === 'loading' ? 'Opening workspace…' : !ready ? 'No open documents' : doc.status === 'pending' ? 'Saving draft…' : doc.status === 'unavailable' ? 'Local storage unavailable' : 'Saved locally'
  const StatusIcon = doc.status === 'unavailable' ? CloudOff : doc.status === 'saved' ? Check : LoaderCircle
  const style = { ...accents, '--writing-font': fonts[appearance.font], '--writing-size': appearance.fontSize + 'px', '--writing-leading': appearance.lineHeight } as CSSProperties
  return <div className="app" data-theme={appearance.theme} style={style} onClickCapture={event => {
    if (document.activeElement === titleInput.current && event.target !== titleInput.current) titleInput.current?.blur()
  }}>
    <header className="topbar">
      <div className="brand" aria-label="Folio"><span className="brand-icon"><FileText size={21} strokeWidth={1.9} /></span><span>folio<span className="brand-period">.</span></span></div>
      <div className="topbar-divider" />
      <div className="document-identity">
        {ready ? <div className="title-line"><input ref={titleInput} aria-label="Document name" key={doc.file.id + doc.file.title} defaultValue={doc.file.title} maxLength={155} onBlur={event => doc.changeTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = doc.file.title; event.currentTarget.blur() } }} style={{ width: Math.min(240, Math.max(120, doc.file.title.length * 8.6 + 17)) }} />
          {doc.dirty && <span className="unsaved-dot" aria-label="Changes since last file save" title="Changes since last file save" />}
        </div> : <span className="workspace-title">Workspace</span>}
        <nav className="menubar" aria-label="Document menu">
          <Menu label="File" items={fileItems} disabled={!started} />
          <Menu label="Edit" items={editItems} disabled={!ready} />
          <Menu label="View" items={viewItems} disabled={!ready} />
          <Menu label="Insert" items={actions} disabled={!editable || source} />
          <Menu label="Format" items={formatMenu} disabled={!editable || source} />
        </nav>
      </div>
      <div className="topbar-actions">
        <IconButton label="Open document library" disabled={!started} onClick={() => execute('document.document-library')}><FolderOpen size={18} /></IconButton>
        <span className={'save-status status-' + doc.status} role="status" title={statusLabel}><StatusIcon size={14} /><span>{statusLabel}</span></span>
        <div className="topbar-action-divider" />
        <div className="mode-selector" role="group" aria-label="Editing mode">
          {editorModes.map(({ mode: choice, label, short, icon: Icon }) => <button type="button" key={choice} disabled={!ready}
            aria-label={label} title={label} aria-pressed={mode === choice} onClick={() => execute('view.mode.' + choice)}><Icon size={15} /><span>{short}</span></button>)}
        </div>
        <IconButton label="Toggle document properties" active={sidebar} disabled={!ready} onClick={() => execute('view.properties')} className="sidebar-toggle"><PanelRight size={18} /></IconButton>
        <Menu label="Export" items={exportItems} align="right" disabled={!ready} className="export-menu"><Download size={16} /><span>Export</span><ChevronDown size={12} /></Menu>
      </div>
    </header>
    <DocumentTabs tabs={doc.tabs} activeId={doc.layout.activeId} canReopen={doc.layout.closed.length > 0} disabled={!started}
      select={id => execute('navigation.open-document', id)} close={id => report(doc.closeTab(id))} closeOthers={id => report(doc.closeOtherTabs(id))} reopen={() => report(doc.reopenTab())} create={() => execute('document.new-document')} />
    <Toolbar editor={editor} state={formatting} source={source} ready={editable} execute={execute} shortcut={commandShortcut} insertItems={actions} extraFormats={formatMenu.slice(5)} styleItems={styleItems} sourceCanUndo={undoAvailable} sourceCanRedo={redoAvailable} />
    {findPanel && doc.layout.activeId && <FindPanel panelRef={findRef} documentId={doc.layout.activeId} title={doc.file.title} mode={mode} startReplace={findPanel.replace}
      find={host.search} capture={doc.captureSearch} subscribe={doc.subscribeSearch} present={doc.presentSearch} replace={doc.applySearch}
      clear={doc.clearSearch} openSource={() => doc.switchMode('source', false)} close={closeSearch} />}
    <div className="workspace">
      <main ref={splitLayout.container} id="document-panel" role={ready ? 'tabpanel' : undefined} aria-labelledby={doc.layout.activeId ? 'document-tab-' + doc.layout.activeId : undefined} className={['canvas', split && 'split-mode', split && splitLayout.stacked && 'split-stacked', splitLayout.dragging && 'split-dragging', appearance.width === 'full' && 'full-width'].filter(Boolean).join(' ')}
        style={split ? { '--visual-share': splitLayout.ratio + 'fr', '--source-share': (1 - splitLayout.ratio) + 'fr', '--divider-width': dividerWidth + 'px' } as CSSProperties : undefined}
        onDragOverCapture={event => { if (draggedBlock.current !== undefined && event.dataTransfer.types.includes(blockDragType)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move' } }}
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true) } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDropCapture={dropBlock} onDrop={acceptDrop}>
        {!started ? <div className="opening-state"><LoaderCircle size={20} className="spinner" /> Opening workspace</div> : !ready && <div className="empty-workspace">
          <FileText size={27} aria-hidden="true" /><h2>No open documents</h2><div><button type="button" className="primary-button" onClick={newFile}>New document</button><button type="button" className="secondary-button" onClick={() => setDialog('library')}>Browse library</button></div>
        </div>}
        <section className="visual-pane" aria-label="Visual pane" hidden={!ready || mode === 'source'}>
          {split && <div className="split-pane-header"><Pilcrow size={15} /><span>Visual Editor</span></div>}
          {doc.previewIssue && <div className="preview-notice" role="status"><CircleAlert size={15} /><span><strong>Preview paused.</strong> {doc.previewIssue}</span></div>}
          <div className="visual-scroll" ref={visualScroll} onScroll={() => { if (grip) setGrip(null); doc.trackView() }}>
            <div className="visual-shell">
            <div className="canvas-strip"><span><FileText size={15} /> Markdown document</span><button type="button" className="width-toggle" onClick={() => execute('view.width')} title="Toggle document width">{appearance.width === 'page' ? <Maximize2 size={14} /> : <Minimize2 size={14} />}{appearance.width === 'page' ? 'Page width' : 'Full width'}</button></div>
              <article className="paper" onPointerDownCapture={event => { if (split && !doc.activatePane('visual')) event.preventDefault() }}
                onFocusCapture={() => { if (split) doc.activatePane('visual') }}
                onBeforeInputCapture={event => { if (!doc.activatePane('visual')) event.preventDefault() }}
                onPointerLeave={() => { if (draggedBlock.current === undefined) setGrip(null) }}
                onPointerMove={event => {
                  if (!editor || doc.previewIssue || event.pointerType !== 'mouse' || (event.target as Element).closest('.block-grip')) return
                  const next = hoveredBlock(editor, event)
                  setGrip(previous => {
                    if (next?.from === previous?.from && next?.top === previous?.top && next?.left === previous?.left) return previous
                    if (!next && previous && event.clientY >= previous.top - 8 && event.clientY <= previous.top + 32) return previous
                    return next
                  })
                }}>
                <EditorContent editor={editor} />
                {grip && !doc.previewIssue && <BlockHandle grip={grip} start={event => {
                  draggedBlock.current = grip.from
                  event.dataTransfer.setData(blockDragType, 'move')
                  event.dataTransfer.effectAllowed = 'move'
                }} end={() => { draggedBlock.current = undefined; setGrip(null) }} />}
              </article>
            </div>
          </div>
        </section>
        {split && <div className="split-divider" role="separator" tabIndex={0} aria-label="Resize editor panes" aria-orientation="vertical" hidden={splitLayout.stacked} {...splitLayout.separator}><i /></div>}
        <section className="source-shell" aria-label="Markdown pane" hidden={!ready || mode === 'visual'}>
          <div className="source-banner"><FileCode2 size={16} /><span>{split ? 'Markdown Source' : /\.(md|markdown)$/i.test(doc.file.title) ? doc.file.title : doc.file.title + '.md'}</span>
            {split && <button type="button" className="sync-scroll" aria-pressed={appearance.syncScroll} onClick={() => execute('view.sync-scroll')}><Link size={14} /> Sync Scroll</button>}
          </div>
          <div className="source-pane-content" onPointerDownCapture={event => { if (split && !doc.activatePane('source')) event.preventDefault() }}
            onFocusCapture={() => { if (split) doc.activatePane('source') }}
            onBeforeInputCapture={event => { if (!doc.activatePane('source')) event.preventDefault() }}>
            {started && <SourceEditor initial={doc.file.source} lineNumberDisplay={appearance.lineNumbers} wordWrap={appearance.wordWrap} canEdit={doc.canEdit} onChange={doc.setSource} onLocation={location => { setLocation(location); doc.trackView() }} onReady={doc.registerSource} />}
          </div>
        </section>
        {dragging && <div className="drop-overlay" aria-hidden="true"><Upload size={29} /><strong>Drop a Markdown file or image</strong></div>}
      </main>
      {ready && sidebar && <Properties tab={tab} setTab={setTab} headings={doc.info.outline} active={doc.activeHeading || doc.info.outline[0]?.anchor || ''} statistics={doc.info.statistics} key={doc.file.id}
        metadata={doc.metadata} onMetadata={doc.changeMetadata} close={() => setSidebar(false)} jump={jump} width={width} setWidth={value => setWidth(Math.min(430, Math.max(250, value)))} />}
    </div>
    <footer className="statusbar">
      <div><span className="mode-indicator"><i />{split ? 'Split mode' : source ? 'Source mode' : 'Visual mode'}</span><span className="status-separator" /><button type="button" onClick={() => openProperties('Statistics')}>{doc.info.statistics.words.toLocaleString()} words</button><span className="reading-time">{doc.info.statistics.minutes} min read</span></div>
      <div>
        {doc.warnings > 0 && !source && <button type="button" className="warning-link" onClick={() => doc.switchMode('source')} title="Open preserved syntax in Markdown source"><CircleAlert size={13} /> {doc.warnings} preserved {doc.warnings === 1 ? 'item' : 'items'}</button>}
        {source && <span>Ln {location.line}, Col {location.column}</span>}
        <span className="status-encoding">UTF-8</span><span className="status-separator" /><span>Markdown</span>
      </div>
    </footer>
    <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void doc.importFile(file); event.target.value = '' }} />
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void addImage(file); event.target.value = '' }} />
    {request && editor && <InsertDialog request={request} editor={editor} anchors={doc.info.outline} close={() => setRequest(null)} chooseLocalImage={() => imageInput.current?.click()} />}
    {palette && <CommandPalette key={palette} entries={paletteEntries()} recent={recentCommands} scope={palette} run={runPalette} close={() => setPalette(null)} />}
    {dialog === 'shortcuts' && <Modal title="Keyboard shortcuts" close={() => setDialog(null)}><dl className="shortcuts">{shortcutRows.map(([label, keys]) => <div key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl></Modal>}
    {dialog === 'recent' && <Modal title="Recent documents" close={() => setDialog(null)}><div className="recent-list">{doc.recent.map(file => <button key={file.id} type="button" onClick={() => report(doc.openDocument(file.id).then(() => setDialog(null)))}><FileText size={17} /><span>{file.title}</span>{file.id === doc.layout.activeId && <small>Current</small>}</button>)}{!doc.recent.length && <p className="muted">Recently opened documents will appear here.</p>}</div></Modal>}
    {dialog === 'library' && <DocumentLibrary items={doc.library} tabs={doc.tabs.map(item => item.id)} close={() => setDialog(null)} create={doc.createDocument} open={doc.openDocument} rename={doc.renameDocument} duplicate={doc.duplicateDocument} remove={doc.deleteDocument} restore={doc.restoreDocument} />}
    {dialog === 'history' && <VersionHistory key={doc.file.id} documentId={doc.file.id} title={doc.file.title} theme={appearance.theme} automaticError={doc.historyError} load={doc.loadVersions} read={host.storage.readVersion} create={doc.createVersion} restore={async version => { await doc.restoreHistoryVersion(version); notify('Version restored') }} close={() => setDialog(null)} />}
    {dialog === 'emoji' && <Modal title="Insert emoji" close={() => setDialog(null)}><div className="emoji-grid">
      {['😀', '👋', '✨', '💡', '✅', '📌', '🗂️', '📝', '📚', '🔎', '🌿', '🎯', '🚀', '⚠️', '❤️', '🙌', '🎉', '📎', '⭐', '🔗'].map(emoji => <button type="button" key={emoji} onClick={() => { editor?.chain().focus().insertContent(emoji).run(); setDialog(null) }}>{emoji}</button>)}
    </div></Modal>}
    {slash && slashItems.length > 0 && !dialog && !request && !palette && <div className="dropdown slash-menu" role="listbox" aria-label="Insert command" style={{ top: slash.top, left: slash.left }}>
      <div className="slash-menu-heading">Insert block</div>
      {slashItems.map((item, index) => <button type="button" role="option" key={item.label} aria-selected={index === slashIndex} onMouseDown={event => event.preventDefault()} onClick={() => runSlash(item)}><span className="item-icon">{item.icon}</span><span>{item.label}</span></button>)}
    </div>}
    {toast && <div className="toast" role="status"><Info size={16} /><span>{toast}</span><IconButton label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></IconButton></div>}
  </div>
}
