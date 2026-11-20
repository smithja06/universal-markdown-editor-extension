import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import { EditorState, Selection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@codemirror/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { createExtensions } from './schema'
import { nodeViewExtensions } from './nodeViews'
import { replaceSource } from './SourceEditor'
import { sourceToVisual, visualToSource } from './markdownSelection'
import { openMarkdown, rebaseMarkdown, setFrontMatter, writeMarkdown, type MarkdownSession } from '../document/markdown'
import { decodeMarkdown, saveMarkdown, type WritableMarkdownHandle } from '../document/files'
import { documentInfo, type Heading } from '../document/metadata'
import { loadWorkspace, newDocument, recentLimit, storeWorkspace, useWorkspace, welcomeSource, type DocumentFile } from '../document/workspace'

type LocalStatus = 'loading' | 'pending' | 'saved' | 'unavailable'
const emptyInfo = { outline: [], statistics: { words: 0, characters: 0, compact: 0, minutes: 0, headings: 0, links: 0, images: 0 } }

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

export function useDocument(notify: (message: string) => void) {
  const [file, setFile] = useState<DocumentFile>(() => newDocument('Getting started', { source: welcomeSource, lineEnding: '\n', bom: false }))
  const [recent, setRecent] = useState<DocumentFile[]>([])
  const [info, setInfo] = useState<ReturnType<typeof documentInfo>>(emptyInfo)
  const [metadata, setMetadata] = useState('')
  const [warnings, setWarnings] = useState(0)
  const [status, setStatus] = useState<LocalStatus>('loading')
  const [visualDirty, setVisualDirty] = useState(false)
  const [activeHeading, setActiveHeading] = useState('')
  const fileRef = useRef(file)
  const recentRef = useRef<DocumentFile[]>([])
  const sourceView = useRef<EditorView | null>(null)
  const sourceBase = useRef(file.source)
  const session = useRef<MarkdownSession | null>(null)
  const parsed = useRef<MarkdownSession | null>(null)
  const cache = useRef<{ document: ProseMirrorNode; source: string; session: MarkdownSession } | null>(null)
  const history = useRef<{ document: ProseMirrorNode; source: string }[]>([])
  const fileHandles = useRef(new Map<string, WritableMarkdownHandle>())
  const visualUpdate = useRef<() => void>(() => {})
  const selectionUpdate = useRef<() => void>(() => {})
  const writing = useRef(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)
  const revision = useRef(0)
  const transition = useRef(0)

  const editor = useEditor({
    extensions: createExtensions(nodeViewExtensions),
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { 'aria-label': 'Visual document editor', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' } },
    onUpdate: () => visualUpdate.current(),
    onSelectionUpdate: () => selectionUpdate.current(),
  })

  const project = useCallback(() => {
    const baseline = session.current
    const file = fileRef.current
    if (useWorkspace.getState().mode === 'source') {
      const source = sourceView.current?.state.doc.toString() ?? file.source
      return source === file.source ? file : { ...file, source }
    }
    if (!editor || !baseline) return file
    const doc = editor.state.doc
    let source = cache.current?.session === baseline && cache.current.document === doc ? cache.current.source : undefined
    if (source === undefined) {
      source = baseline.document.eq(doc) ? baseline.source
        : history.current.find(item => item.document.eq(doc))?.source ?? writeMarkdown(baseline, doc).source
      cache.current = { document: doc, source, session: baseline }
    }
    return source === file.source ? file : { ...file, source }
  }, [editor])

  const parseSource = useCallback((source: string) => {
    if (!editor) throw new Error('The editor is still opening.')
    if (session.current?.source === source) return session.current
    if (parsed.current?.source !== source) parsed.current = openMarkdown(source, editor.schema)
    return parsed.current
  }, [editor])

  const replaceFile = useCallback((next: DocumentFile) => {
    fileRef.current = next
    setFile(next)
  }, [])

  const summarize = useCallback((value: MarkdownSession, doc = value.document) => {
    setInfo(documentInfo(doc))
    setMetadata(value.frontMatter?.value ?? '')
    setWarnings(value.warnings)
  }, [])

  const snapshot = useCallback((next: DocumentFile, records = recentRef.current) => {
    const files = [next, ...records.filter(item => item.id !== next.id)].slice(0, recentLimit)
    recentRef.current = files
    setRecent(files)
    const ticket = ++revision.current
    writing.current = writing.current.catch(() => undefined).then(() => storeWorkspace({ currentId: next.id, files }))
    void writing.current.then(
      () => { if (ticket === revision.current) setStatus('saved') },
      () => { if (ticket === revision.current) setStatus('unavailable') },
    )
  }, [])

  const flush = useCallback(() => {
    if (!editor || !session.current) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    try {
      const projected = project()
      const next = { ...projected, updated: Date.now() }
      replaceFile(next)
      setVisualDirty(false)
      snapshot(next)
      if (useWorkspace.getState().mode === 'source') summarize(parseSource(next.source))
      else {
        setInfo(documentInfo(editor.state.doc))
        let count = 0
        editor.state.doc.descendants(node => { if (node.type.name === 'rawBlock' || node.type.name === 'rawInline') count++ })
        setWarnings(count)
      }
    } catch (error) {
      setStatus('unavailable')
      notify(errorMessage(error))
    }
  }, [editor, notify, parseSource, project, replaceFile, snapshot, summarize])

  const schedule = useCallback(() => {
    revision.current++
    setStatus('pending')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 480)
  }, [flush])

  visualUpdate.current = () => {
    if (useWorkspace.getState().mode !== 'visual') return
    if (editor) setMetadata(editor.state.doc.attrs.frontMatter ?? '')
    setVisualDirty(true)
    schedule()
  }
  selectionUpdate.current = () => {
    if (!editor || useWorkspace.getState().mode !== 'visual') return
    const selection = editor.state.selection
    let position = selection.from
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      if (selection.$from.node(depth).type.name === 'heading') { position = selection.$from.before(depth); break }
    }
    let anchor = ''
    for (const heading of info.outline) {
      if (heading.position > position) break
      anchor = heading.anchor
    }
    setActiveHeading(anchor)
  }

  const applySession = useCallback((baseline: MarkdownSession, keepHistory = false) => {
    if (!editor) return
    const oldState = editor.state
    if (keepHistory) {
      baseline = rebaseMarkdown(baseline, oldState.doc)
      const next = baseline.document
      const overlap = Math.min(oldState.doc.childCount, next.childCount)
      let prefix = 0
      let from = 0
      while (prefix < overlap && oldState.doc.child(prefix).eq(next.child(prefix))) from += next.child(prefix++).nodeSize
      let suffixSize = 0
      for (let suffix = 1; prefix + suffix <= overlap; suffix++) {
        const node = next.child(next.childCount - suffix)
        if (!node.eq(oldState.doc.child(oldState.doc.childCount - suffix))) break
        suffixSize += node.nodeSize
      }
      const transaction = closeHistory(oldState.tr).setMeta('preventUpdate', true)
      const oldEnd = oldState.doc.content.size - suffixSize
      const newEnd = next.content.size - suffixSize
      if (from !== oldEnd || from !== newEnd) transaction.replaceWith(from, oldEnd, next.content.cut(from, newEnd))
      if (oldState.doc.attrs.frontMatter !== next.attrs.frontMatter) transaction.setDocAttribute('frontMatter', next.attrs.frontMatter)
      if (transaction.docChanged) {
        editor.view.dispatch(transaction)
        editor.view.dispatch(closeHistory(editor.state.tr))
      }
    } else {
      editor.view.updateState(EditorState.create({ schema: editor.schema, doc: baseline.document, plugins: oldState.plugins }))
    }
    session.current = baseline
    cache.current = null
    summarize(baseline)
    setActiveHeading('')
  }, [editor, summarize])

  useEffect(() => {
    if (!editor) return
    let active = true
    const restore = async () => {
      let stored: Awaited<ReturnType<typeof loadWorkspace>>
      let storageError = false
      try { stored = await loadWorkspace() } catch { storageError = true }
      if (!active) return
      const loaded = stored?.files.find(item => item.id === stored?.currentId) ?? fileRef.current
      replaceFile(loaded)
      recentRef.current = stored?.files ?? [loaded]
      setRecent(recentRef.current)
      useWorkspace.getState().setMode('visual')
      sourceBase.current = loaded.source
      applySession(openMarkdown(loaded.source, editor.schema))
      setStatus(storageError ? 'unavailable' : stored ? 'saved' : 'pending')
      if (!stored && !storageError) snapshot(loaded)
    }
    void restore().catch(error => { if (active) { setStatus('unavailable'); notify(errorMessage(error)) } })
    return () => { active = false }
  }, [editor, applySession, notify, replaceFile, snapshot])

  useEffect(() => {
    const onHidden = (event: Event) => {
      if (timer.current !== undefined && (event.type === 'pagehide' || document.visibilityState === 'hidden')) flush()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', onHidden); window.clearTimeout(timer.current) }
  }, [flush])

  const setSource = useCallback((source: string) => {
    if (useWorkspace.getState().mode !== 'source' || fileRef.current.source === source) return
    fileRef.current = { ...fileRef.current, source }
    schedule()
  }, [schedule])

  function switchMode(mode: 'visual' | 'source', focus = true) {
    if (!editor || !session.current || mode === useWorkspace.getState().mode) return
    try {
      const next = project()
      const projection = parseSource(next.source)
      const view = sourceView.current
      let caret: number
      if (mode === 'source') {
        caret = visualToSource(editor.state.doc, editor.state.selection.head, projection)
        replaceFile(next)
        replaceSource(view, next.source, 'visual')
        sourceBase.current = next.source
        const doc = editor.state.doc
        if (history.current[0]?.source !== next.source || !history.current[0]?.document.eq(doc)) {
          history.current = [{ document: doc, source: next.source }, ...history.current].slice(0, 24)
        }
      } else {
        if (next.source !== sourceBase.current) {
          applySession(projection, true)
          replaceFile(next)
        }
        caret = sourceToVisual(projection, view?.state.selection.main.head ?? 0, editor.state.doc)
      }
      useWorkspace.getState().setMode(mode)
      setVisualDirty(false)
      if (timer.current !== undefined) flush()
      const token = ++transition.current
      if (focus) requestAnimationFrame(() => {
        if (token !== transition.current || next.id !== fileRef.current.id || useWorkspace.getState().mode !== mode) return
        if (mode === 'source' && view) {
          view.dispatch({ selection: { anchor: Math.min(caret, view.state.doc.length) }, scrollIntoView: true })
          view.focus()
        } else if (mode === 'visual') {
          const { state } = editor
          const selection = Selection.near(state.doc.resolve(Math.min(caret, state.doc.content.size)))
          if (!state.selection.eq(selection)) editor.view.dispatch(state.tr.setSelection(selection).setMeta('addToHistory', false).scrollIntoView())
          editor.view.focus()
        }
      })
    } catch (error) { notify(errorMessage(error)) }
  }

  function openFile(next: DocumentFile) {
    if (!editor) return
    try {
      const previous = project()
      const pending = timer.current !== undefined
      const baseline = openMarkdown(next.source, editor.schema)
      window.clearTimeout(timer.current)
      timer.current = undefined
      history.current = []
      transition.current++
      applySession(baseline)
      useWorkspace.getState().setMode('visual')
      sourceBase.current = next.source
      replaceFile(next)
      setVisualDirty(false)
      const last = pending ? { ...previous, updated: Date.now() } : previous
      snapshot(next, [last, ...recentRef.current.filter(item => item.id !== previous.id)])
    } catch (error) { notify(errorMessage(error)) }
  }

  async function importFile(input: File) {
    if (!/\.(md|markdown)$/i.test(input.name)) { notify('Choose a .md or .markdown file.'); return }
    try {
      const decoded = decodeMarkdown(new Uint8Array(await input.arrayBuffer()))
      openFile(newDocument(input.name.replace(/\.md$/i, ''), decoded))
      notify('Opened ' + input.name)
    } catch (error) { notify('Could not open the UTF-8 file. ' + errorMessage(error)) }
  }

  async function save(options: { saveAs?: boolean; download?: boolean } = {}) {
    try {
      const next = project()
      const result = await saveMarkdown(next, next.title, { ...options, handle: fileHandles.current.get(next.id) })
      if (result.handle) fileHandles.current.set(next.id, result.handle)
      if (next.id === fileRef.current.id && !options.download) {
        const updated = { ...project(), savedSource: next.source, savedTitle: next.title, updated: Date.now() }
        replaceFile(updated)
        snapshot(updated)
      }
      notify(result.handle ? 'Saved to ' + result.filename : 'Downloaded ' + result.filename)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('Could not save the file. ' + errorMessage(error))
    }
  }

  function changeTitle(title: string) {
    const normalized = title.trim() || 'Untitled document'
    if (normalized === fileRef.current.title) return
    replaceFile({ ...fileRef.current, title: normalized })
    schedule()
  }

  function changeMetadata(value: string) {
    if (!editor) return
    try {
      if (useWorkspace.getState().mode === 'source') {
        const current = project()
        const updated = setFrontMatter(openMarkdown(current.source, editor.schema), value)
        if (updated === current.source) return
        replaceSource(sourceView.current, updated, 'metadata')
        if (fileRef.current.source !== updated) setSource(updated)
        setMetadata(value)
      } else {
        if (editor.state.doc.attrs.frontMatter === value) return
        editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('frontMatter', value))
        editor.view.dispatch(closeHistory(editor.state.tr))
      }
    } catch (error) { notify(errorMessage(error)) }
  }

  function jumpToHeading(heading: Heading) {
    if (!editor) return
    setActiveHeading(heading.anchor)
    if (useWorkspace.getState().mode === 'source') {
      const view = sourceView.current
      if (!view) return
      const source = view.state.doc.toString()
      const baseline = openMarkdown(source, editor.schema)
      let position = 0
      const block = baseline.blocks.find(item => {
        const matches = heading.position >= position && heading.position < position + item.node.nodeSize
        position += item.node.nodeSize
        return matches
      })
      if (block) {
        view.dispatch({ selection: { anchor: block.start }, scrollIntoView: true })
        view.focus()
      }
    } else {
      editor.chain().focus().setTextSelection(heading.position + 1).scrollIntoView().run()
    }
  }

  return {
    editor, file, recent, status, sourceView, setSource, info, metadata, warnings, activeHeading,
    dirty: visualDirty || file.source !== file.savedSource || file.title !== file.savedTitle,
    project, switchMode, openFile, importFile, save, changeTitle, changeMetadata, jumpToHeading,
  }
}
