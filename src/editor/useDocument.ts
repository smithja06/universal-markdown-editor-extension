import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useEditor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { EditorState, Plugin, Selection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@codemirror/view'
import type { EditorState as SourceState } from '@codemirror/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { createExtensions } from './schema'
import { nodeViewExtensions } from './nodeViews'
import { replaceSource, type SourceRuntime } from './SourceEditor'
import { useDocumentCollection } from './useDocumentCollection'
import { sourceToVisual, visualToSource } from './markdownSelection'
import { validateSource } from './sourceDiagnostics'
import { visualProjection } from './visualProjection'
import { applyRenderedHits, replaceSearchHits, searchDocument, searchVisualOffsets, type SearchDocument, type SearchHit, type SearchScope } from './documentSearch'
import { highlightSourceSearch, highlightVisualSearch, VisualSearchDecorations } from './searchDecorations'
import { splitAnchors, type BlockAnchor } from './splitScroll'
import { openMarkdown, rebaseMarkdown, setFrontMatter, writeMarkdown, type MarkdownSession } from '../document/markdown'
import type { WritableMarkdownHandle } from '../document/files'
import { WorkspaceRestoreConflict, type FileInput, type FolioHost } from '../host/contracts'
import { documentInfo, type Heading } from '../document/metadata'
import { availableTitle, draftSummary, emptyLayout, newDocument, welcomeSource, withoutTabs, type DocumentFile, type EditorMode, type EditorPane, type TabView, type WorkspaceLayout, type WorkspaceView } from '../document/workspace'
import { versionInterval, versionStorageError, type DocumentVersion, type VersionTrigger } from '../document/versions'

type LocalStatus = 'loading' | 'pending' | 'saved' | 'unavailable'
const emptyInfo = { outline: [], statistics: { words: 0, characters: 0, compact: 0, minutes: 0, headings: 0, links: 0, images: 0 } }

interface TabSession {
  state: EditorState
  source?: SourceState
  markdown: MarkdownSession
  authority: EditorPane
  issue: string | null
  history: { document: ProseMirrorNode; source: string }[]
  paired: { source: string; document: ProseMirrorNode } | null
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

export function useDocument(notify: (message: string) => void, visualScroll: RefObject<HTMLDivElement | null>, { storage, files }: FolioHost, viewSettings: WorkspaceView) {
  const collection = useDocumentCollection(storage)
  const { workspace, documents, drafts, persisted, writing, enqueue, changeLayout, loadCollection, loadFile, persist, cache: cacheFile, opened, updateSummary, forget } = collection
  const [file, setFile] = useState<DocumentFile>(() => newDocument('Getting started', { source: welcomeSource, lineEnding: '\n', bom: false }))
  const [info, setInfo] = useState<ReturnType<typeof documentInfo>>(emptyInfo)
  const [metadata, setMetadata] = useState('')
  const [warnings, setWarnings] = useState(0)
  const [status, setStatus] = useState<LocalStatus>('loading')
  const [visualDirty, setVisualDirty] = useState(false)
  const [activeHeading, setActiveHeading] = useState('')
  const [activePane, setActivePane] = useState<EditorPane>('visual')
  const [previewIssue, setPreviewIssue] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [saveStatuses, setSaveStatuses] = useState<Record<string, LocalStatus>>({})
  const fileRef = useRef(file)
  const tabSessions = useRef(new Map<string, TabSession>())
  const sourceRuntime = useRef<SourceRuntime | null>(null)
  const initialView = useRef<TabView | undefined>(undefined)
  const pendingScroll = useRef<TabView | undefined>(undefined)
  const sourceView = useRef<EditorView | null>(null)
  const authority = useRef<EditorPane>('visual')
  const active = useRef<EditorPane>('visual')
  const issue = useRef<string | null>(null)
  const paired = useRef<{ source: string; document: ProseMirrorNode; version: number } | null>(null)
  const anchors = useRef<{ pair: NonNullable<typeof paired.current>; blocks: BlockAnchor[] } | null>(null)
  const session = useRef<MarkdownSession | null>(null)
  const parsed = useRef<MarkdownSession | null>(null)
  const cache = useRef<{ document: ProseMirrorNode; source: string; session: MarkdownSession } | null>(null)
  const history = useRef<{ document: ProseMirrorNode; source: string }[]>([])
  const fileHandles = useRef(new Map<string, WritableMarkdownHandle>())
  const visualUpdate = useRef<() => void>(() => {})
  const selectionUpdate = useRef<() => void>(() => {})
  const timer = useRef<number | undefined>(undefined)
  const viewTimer = useRef<number | undefined>(undefined)
  const versionTimer = useRef<number | undefined>(undefined)
  const mirrorTimer = useRef<number | undefined>(undefined)
  const editVersion = useRef(0)
  const revision = useRef(new Map<string, number>())
  const saveStatusRef = useRef(new Map<string, LocalStatus>())
  const transition = useRef(0)
  const openIntent = useRef(0)
  const restoring = useRef(false)
  const searchCache = useRef<Partial<Record<SearchScope, SearchDocument>>>({})
  const searchListeners = useRef(new Set<() => void>())
  const canEdit = useCallback(() => !!workspace.current.activeId && !restoring.current, [workspace])
  const refreshSearch = useCallback(() => { for (const listener of searchListeners.current) listener() }, [])
  const subscribeSearch = useCallback((listener: () => void) => {
    searchListeners.current.add(listener)
    return () => { searchListeners.current.delete(listener) }
  }, [])

  const editor = useEditor({
    extensions: [...createExtensions(nodeViewExtensions), VisualSearchDecorations, Extension.create({
      name: 'workspaceEditing',
      addProseMirrorPlugins: () => [new Plugin({ filterTransaction: transaction => !transaction.docChanged || canEdit() })],
    })],
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { 'aria-label': 'Visual document editor', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' } },
    onUpdate: () => visualUpdate.current(),
    onSelectionUpdate: () => selectionUpdate.current(),
  })

  const project = useCallback(() => {
    const baseline = session.current
    const file = fileRef.current
    if (authority.current === 'source') {
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

  const markStatus = useCallback((id: string, value: LocalStatus) => {
    saveStatusRef.current.set(id, value)
    setSaveStatuses(previous => previous[id] === value ? previous : { ...previous, [id]: value })
    if (workspace.current.activeId === id) setStatus(value)
  }, [workspace])

  const saveLayout = useCallback((next: WorkspaceLayout) => {
    void changeLayout(next).catch(error => notify('Could not save the tab layout. ' + errorMessage(error)))
  }, [changeLayout, notify])

  const captureView = useCallback((): TabView | undefined => {
    if (!editor || !workspace.current.activeId) return
    const previous = workspace.current.tabs.find(tab => tab.id === workspace.current.activeId)
    const { selection } = editor.state
    const source = sourceView.current
    const visual = visualScroll.current
    const mode = viewSettings.getState().mode
    const restoringView = pendingScroll.current?.id === previous?.id ? pendingScroll.current : undefined
    return {
      id: workspace.current.activeId, mode, pane: active.current,
      visual: { anchor: selection.anchor, head: selection.head, top: restoringView?.visual?.top ?? (visual?.clientHeight ? visual.scrollTop : previous?.visual?.top ?? 0), left: restoringView?.visual?.left ?? (visual?.clientWidth ? visual.scrollLeft : previous?.visual?.left ?? 0) },
      source: source ? { anchor: source.state.selection.main.anchor, head: source.state.selection.main.head,
        top: restoringView?.source?.top ?? (source.scrollDOM.clientHeight ? source.scrollDOM.scrollTop : previous?.source?.top ?? 0), left: restoringView?.source?.left ?? (source.scrollDOM.clientWidth ? source.scrollDOM.scrollLeft : previous?.source?.left ?? 0) } : previous?.source,
    }
  }, [editor, visualScroll, workspace, viewSettings])

  const saveView = useCallback(() => {
    const view = captureView()
    if (view) saveLayout({ ...workspace.current, tabs: workspace.current.tabs.map(tab => tab.id === view.id ? view : tab) })
  }, [captureView, saveLayout, workspace])

  const trackView = useCallback(() => {
    const id = workspace.current.activeId
    if (!id || restoring.current || pendingScroll.current?.id === id) return
    window.clearTimeout(viewTimer.current)
    viewTimer.current = window.setTimeout(() => {
      if (!restoring.current && workspace.current.activeId === id) saveView()
    }, 350)
  }, [saveView, workspace])

  const automaticVersion = useCallback(async (candidate: DocumentFile, trigger: Exclude<VersionTrigger, 'manual'>) => {
    try {
      const result = await storage.recordVersion(candidate, trigger)
      if (fileRef.current.id === candidate.id && result.status !== 'deferred') setHistoryError('')
      return result
    } catch (error) {
      if (fileRef.current.id === candidate.id) setHistoryError(versionStorageError(error))
    }
  }, [storage])

  const queueVersion = useCallback((candidate: DocumentFile, trigger: Exclude<VersionTrigger, 'manual'>) => {
    return enqueue(() => automaticVersion(candidate, trigger))
  }, [automaticVersion, enqueue])

  const persistDraft = useCallback((next: DocumentFile, trigger: Exclude<VersionTrigger, 'manual'> = 'interval', words?: number, created = false) => {
    const ticket = (revision.current.get(next.id) ?? 0) + 1
    revision.current.set(next.id, ticket)
    markStatus(next.id, 'pending')
    const saved = persist(next, words, created)
    void saved.then(
      () => { if (ticket === revision.current.get(next.id)) markStatus(next.id, 'saved') },
      error => {
        if (ticket !== revision.current.get(next.id)) return
        markStatus(next.id, 'unavailable')
        if (error instanceof WorkspaceRestoreConflict) notify(error.message)
      },
    )
    void enqueue(async () => {
      await saved
      await automaticVersion(next, trigger)
    }).catch(() => undefined)
    return saved
  }, [automaticVersion, enqueue, markStatus, notify, persist])

  const flush = useCallback((checkpoint = false) => {
    if (!editor || !session.current || restoring.current) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    try {
      const projected = project()
      const next = { ...projected, updated: Math.max(Date.now(), projected.updated + 1) }
      replaceFile(next)
      setVisualDirty(false)
      const words = documentInfo(authority.current === 'source' ? parseSource(next.source).document : editor.state.doc).statistics.words
      void persistDraft(next, checkpoint ? 'checkpoint' : 'interval', words)
      saveView()
      if (viewSettings.getState().mode === 'source' && !issue.current) summarize(parseSource(next.source))
      else if (!issue.current) {
        setInfo(documentInfo(editor.state.doc))
        let count = 0
        editor.state.doc.descendants(node => { if (node.type.name === 'rawBlock' || node.type.name === 'rawInline') count++ })
        setWarnings(count)
      }
    } catch (error) {
      setStatus('unavailable')
      notify(errorMessage(error))
    }
  }, [editor, notify, parseSource, persistDraft, project, replaceFile, saveView, summarize, viewSettings])

  const scheduleVersionCheck = useCallback(function checkLater(delay: number) {
    const id = fileRef.current.id
    versionTimer.current = window.setTimeout(() => {
      versionTimer.current = undefined
      if (restoring.current || fileRef.current.id !== id) return
      if (timer.current !== undefined) flush()
      void queueVersion(project(), 'interval').then(result => {
        if (result?.status === 'deferred' && !restoring.current && fileRef.current.id === id && versionTimer.current === undefined) {
          checkLater(Math.max(1, result.version.createdAt + versionInterval - Date.now()))
        }
      })
    }, delay)
  }, [flush, project, queueVersion])

  const schedule = useCallback(() => {
    const id = fileRef.current.id
    revision.current.set(id, (revision.current.get(id) ?? 0) + 1)
    markStatus(id, 'pending')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 480)
    if (versionTimer.current === undefined) scheduleVersionCheck(versionInterval)
  }, [flush, markStatus, scheduleVersionCheck])

  selectionUpdate.current = () => {
    if (!editor || viewSettings.getState().mode === 'source') return
    trackView()
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

  const applySession = useCallback((baseline: MarkdownSession, update: 'reset' | 'history' | 'mirror' = 'reset') => {
    if (!editor) return
    const oldState = editor.state
    if (update !== 'reset') {
      baseline = rebaseMarkdown(baseline, oldState.doc)
      const transaction = visualProjection(oldState, baseline.document, update === 'history')
      if (transaction.docChanged) {
        editor.view.dispatch(transaction)
        if (update === 'history') editor.view.dispatch(closeHistory(editor.state.tr))
      }
    } else {
      editor.view.updateState(EditorState.create({ schema: editor.schema, doc: baseline.document, plugins: oldState.plugins }))
    }
    session.current = baseline
    paired.current = { source: baseline.source, document: editor.state.doc, version: editVersion.current }
    cache.current = null
    summarize(baseline)
    if (update === 'reset') setActiveHeading('')
    refreshSearch()
  }, [editor, refreshSearch, summarize])

  const setIssue = useCallback((message: string | null) => {
    if (issue.current === message) return
    const wasPaused = Boolean(issue.current)
    issue.current = message
    setPreviewIssue(message)
    if (wasPaused !== Boolean(message)) editor?.setEditable(!message, false)
  }, [editor])

  const remember = useCallback((document: ProseMirrorNode, source: string) => {
    const latest = history.current[0]
    if (latest?.source === source && latest.document.eq(document)) return
    history.current = [{ document, source }, ...history.current].slice(0, 24)
  }, [])

  const synchronize = useCallback((recordHistory: boolean, checkIncomplete: boolean) => {
    if (!editor || !session.current) return false
    const next = project()
    const current = editor.state.doc
    if (authority.current === 'visual') {
      const view = sourceView.current
      const sourceChanged = !!view && view.state.doc.toString() !== next.source
      replaceSource(sourceView.current, next.source, 'visual', recordHistory)
      paired.current = { source: next.source, document: current, version: editVersion.current }
      remember(current, next.source)
      if (sourceChanged) refreshSearch()
      return true
    }
    if (paired.current?.source === next.source && paired.current.document === current) {
      paired.current.version = editVersion.current
      setIssue(null)
      return true
    }
    if (checkIncomplete) {
      const diagnostic = validateSource(next.source)[0]
      if (diagnostic) {
        setIssue(diagnostic.message)
        return false
      }
    }
    if (paired.current?.document === current) remember(current, paired.current.source)
    applySession(parseSource(next.source), recordHistory ? 'history' : 'mirror')
    setIssue(null)
    return true
  }, [applySession, editor, parseSource, project, refreshSearch, remember, setIssue])

  const queueEdit = useCallback((origin: EditorPane) => {
    authority.current = origin
    const version = ++editVersion.current
    setVisualDirty(true)
    schedule()
    refreshSearch()
    window.clearTimeout(mirrorTimer.current)
    if (viewSettings.getState().mode !== 'split') return
    mirrorTimer.current = window.setTimeout(() => {
      if (restoring.current || version !== editVersion.current || viewSettings.getState().mode !== 'split') return
      try { synchronize(false, true) }
      catch (error) {
        if (origin === 'source') setIssue(errorMessage(error))
        else notify(errorMessage(error))
      }
    }, 140)
  }, [notify, refreshSearch, schedule, setIssue, synchronize, viewSettings])

  visualUpdate.current = () => {
    if (!canEdit() || viewSettings.getState().mode === 'source' || issue.current) return
    if (editor) setMetadata(editor.state.doc.attrs.frontMatter ?? '')
    queueEdit('visual')
  }

  const activatePane = useCallback((pane: EditorPane) => {
    if (restoring.current || !workspace.current.activeId) return false
    const mode = viewSettings.getState().mode
    if (mode !== 'split') return mode === pane && !(pane === 'visual' && issue.current)
    try {
      if (pane !== authority.current && !synchronize(false, true)) return false
      if (active.current !== pane) {
        transition.current++
        active.current = pane
        setActivePane(pane)
      }
      return true
    } catch (error) {
      notify(errorMessage(error))
      return false
    }
  }, [notify, synchronize, workspace, viewSettings])

  const restoreScroll = useCallback((view: TabView) => {
    pendingScroll.current = view
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pendingScroll.current !== view || workspace.current.activeId !== view.id) return
      const visual = visualScroll.current
      const source = sourceView.current?.scrollDOM
      if (visual) { visual.scrollTop = view.visual?.top ?? 0; visual.scrollLeft = view.visual?.left ?? 0 }
      if (source) { source.scrollTop = view.source?.top ?? 0; source.scrollLeft = view.source?.left ?? 0 }
      pendingScroll.current = undefined
    }))
  }, [visualScroll, workspace])

  const applySourceSelection = useCallback((view: TabView) => {
    const source = sourceView.current
    if (source && view.source) {
      const { anchor, head } = view.source
      source.dispatch({ selection: { anchor: Math.min(anchor, source.state.doc.length), head: Math.min(head, source.state.doc.length) } })
    }
  }, [])

  const registerSource = useCallback((runtime: SourceRuntime | null) => {
    sourceRuntime.current?.view.scrollDOM.removeEventListener('scroll', trackView)
    sourceRuntime.current = runtime
    sourceView.current = runtime?.view ?? null
    runtime?.view.scrollDOM.addEventListener('scroll', trackView, { passive: true })
    const view = initialView.current
    if (runtime && view?.id === workspace.current.activeId) {
      applySourceSelection(view)
      restoreScroll(view)
    }
  }, [applySourceSelection, restoreScroll, trackView, workspace])

  const showTab = useCallback((next: DocumentFile, view: TabView) => {
    if (!editor) return
    const resumed = tabSessions.current.get(next.id)
    tabSessions.current.delete(next.id)
    const baseline = resumed?.markdown ?? openMarkdown(next.source, editor.schema)
    transition.current++
    editVersion.current++
    parsed.current = null
    cache.current = null
    anchors.current = null
    history.current = resumed?.history ?? []
    authority.current = resumed?.authority ?? (view.mode === 'source' ? 'source' : 'visual')
    active.current = view.mode === 'split' ? view.pane ?? 'visual' : view.mode
    viewSettings.getState().setMode(view.mode)
    setActivePane(active.current)
    setIssue(resumed?.issue ?? null)
    if (resumed) {
      editor.view.updateState(resumed.state)
      session.current = baseline
      paired.current = resumed.paired ? { ...resumed.paired, version: editVersion.current } : null
      setActiveHeading('')
    } else {
      applySession(baseline)
      if (view.visual) {
        const { doc, tr } = editor.state
        editor.view.dispatch(tr.setSelection(TextSelection.between(doc.resolve(Math.min(view.visual.anchor, doc.content.size)), doc.resolve(Math.min(view.visual.head, doc.content.size)))).setMeta('addToHistory', false))
      }
    }
    replaceFile(next)
    const visible = view.mode === 'source' ? openMarkdown(next.source, editor.schema) : baseline
    summarize(visible, view.mode === 'source' ? visible.document : editor.state.doc)
    if (view.mode !== 'source') {
      setMetadata(editor.state.doc.attrs.frontMatter ?? '')
      let preserved = 0
      editor.state.doc.descendants(node => { if (node.type.name === 'rawBlock' || node.type.name === 'rawInline') preserved++ })
      setWarnings(preserved)
    }
    if (sourceRuntime.current) {
      sourceRuntime.current.apply(resumed?.source ?? next.source)
      if (!resumed?.source) applySourceSelection(view)
    }
    initialView.current = view
    restoreScroll(view)
    setVisualDirty(false)
    setHistoryError('')
    setEditorEpoch(value => value + 1)
    setStatus(saveStatusRef.current.get(next.id) ?? 'saved')
    refreshSearch()
  }, [applySession, applySourceSelection, editor, refreshSearch, replaceFile, restoreScroll, setIssue, summarize, viewSettings])

  const clearSearch = useCallback(() => {
    searchCache.current = {}
    if (editor && !editor.isDestroyed) highlightVisualSearch(editor, [])
    if (sourceView.current) highlightSourceSearch(sourceView.current, [])
  }, [editor])

  const captureSearch = useCallback((scope: SearchScope) => {
    const id = workspace.current.activeId
    if (!id || !editor || !session.current) return
    const cached = searchCache.current[scope]
    if (cached?.id === id && cached.revision === editVersion.current) return cached
    const source = project().source
    const incomplete = scope === 'rendered' && validateSource(source).length > 0
    const visible = incomplete && viewSettings.getState().mode === 'split' ? paired.current?.source ?? session.current.source : source
    const snapshot = searchDocument(id, editVersion.current, parseSource(visible), !incomplete)
    searchCache.current[scope] = snapshot
    return snapshot
  }, [editor, parseSource, project, workspace, viewSettings])

  const presentSearch = useCallback((model: SearchDocument, hits: SearchHit[], current: number, scroll: boolean) => {
    if (!editor || editor.isDestroyed || model.id !== workspace.current.activeId || model.revision !== editVersion.current) return
    const selected = hits[current]
    const mode = viewSettings.getState().mode
    const view = sourceView.current
    const sourceCurrent = !!view && mode !== 'visual' && view.state.doc.toString() === model.session.source
    const visualCurrent = mode !== 'source' && (authority.current === 'visual' || paired.current?.source === model.session.source)
    const offsets = visualCurrent ? searchVisualOffsets(model, editor.state.doc) : new Map<number, number>()
    const sourceRanges = sourceCurrent ? hits.flatMap((hit, index) => hit.source.map(range => ({ ...range, current: index === current }))) : []
    const visualRanges = hits.flatMap((hit, index) => hit.visual.flatMap(range => {
      const offset = offsets.get(range.block)
      return offset === undefined ? [] : [{ from: range.from + offset, to: range.to + offset, current: index === current }]
    }))
    highlightVisualSearch(editor, visualRanges)
    if (view) {
      const from = scroll && sourceCurrent && selected ? selected.source[0]?.from ?? (selected.block === undefined ? undefined : model.blocks[selected.block].source.from) : undefined
      highlightSourceSearch(view, sourceRanges, from)
    }
    const activeRange = scroll ? visualRanges.find(range => range.current) : undefined
    const scroller = visualScroll.current
    if (activeRange && scroller) {
      const position = editor.view.coordsAtPos(activeRange.from)
      const bounds = scroller.getBoundingClientRect()
      if (position.top < bounds.top || position.bottom > bounds.bottom) scroller.scrollTop += position.top - bounds.top - bounds.height / 3
    }
  }, [editor, visualScroll, workspace, viewSettings])

  const stashTab = useCallback(() => {
    const id = workspace.current.activeId
    if (!id || !editor || !session.current) return
    const pending = timer.current !== undefined
    if (viewSettings.getState().mode === 'split') synchronize(false, true)
    const current = project()
    clearSearch()
    window.clearTimeout(timer.current)
    window.clearTimeout(viewTimer.current)
    window.clearTimeout(versionTimer.current)
    window.clearTimeout(mirrorTimer.current)
    timer.current = undefined
    versionTimer.current = undefined
    // Preserve the exact draft and both histories before reusing either editor view.
    tabSessions.current.set(id, { state: editor.state, source: sourceView.current?.state, markdown: session.current,
      authority: authority.current, issue: issue.current, history: history.current, paired: paired.current })
    const known = drafts.current.get(id)
    if (pending || !known || current.source !== known.source || current.title !== known.title || saveStatusRef.current.get(id) === 'unavailable') {
      const next = { ...current, updated: Math.max(Date.now(), current.updated + 1) }
      const words = documentInfo(authority.current === 'source' ? parseSource(next.source).document : editor.state.doc).statistics.words
      void persistDraft(next, 'checkpoint', words)
      replaceFile(next)
    } else void queueVersion(current, 'checkpoint')
    return captureView()
  }, [captureView, clearSearch, drafts, editor, parseSource, persistDraft, project, queueVersion, replaceFile, synchronize, workspace, viewSettings])

  useEffect(() => {
    if (!editor) return
    let active = true
    const restore = async () => {
      try {
        const [items, stored] = await Promise.all([storage.loadLibrary(), storage.loadLayout()])
        if (!active) return
        const live = new Set(items.filter(item => item.deletedAt === undefined).map(item => item.id))
        if (stored || items.length) {
          const value = stored ?? emptyLayout
          const invalid = new Set([...value.tabs, ...value.closed].filter(tab => !live.has(tab.id)).map(tab => tab.id))
          const allowed = withoutTabs(value, invalid, false)
          loadCollection(items, allowed)
          const view = allowed.tabs.find(tab => tab.id === allowed.activeId)
          if (!view) { setStatus('saved'); return }
          const loaded = await loadFile(view.id)
          if (!active) return
          if (!loaded) { saveLayout(withoutTabs(allowed, new Set([view.id]), false)); setStatus('saved'); return }
          showTab(loaded, view)
          void queueVersion(loaded, 'checkpoint')
          return
        }
        const current = fileRef.current
        const first: TabView = { id: current.id, mode: 'visual' }
        loadCollection([], emptyLayout)
        void persistDraft(current, 'checkpoint', documentInfo(openMarkdown(current.source, editor.schema).document).statistics.words, true)
        void opened(current.id)?.catch(() => undefined)
        saveLayout({ activeId: current.id, tabs: [first], closed: [] })
        showTab(current, first)
      } catch {
        if (!active) return
        const current = fileRef.current
        const view: TabView = { id: current.id, mode: 'visual' }
        loadCollection([draftSummary(current)], { activeId: current.id, tabs: [view], closed: [] })
        cacheFile(current, undefined, true)
        showTab(current, view)
        markStatus(current.id, 'unavailable')
      }
    }
    void restore().catch(error => { if (active) { setStatus('unavailable'); notify(errorMessage(error)) } })
    return () => { active = false }
  }, [editor, cacheFile, loadCollection, loadFile, markStatus, notify, opened, persistDraft, queueVersion, saveLayout, showTab, storage])

  useEffect(() => {
    const onHidden = (event: Event) => {
      if (restoring.current || !session.current || (event.type !== 'pagehide' && document.visibilityState !== 'hidden')) return
      if (timer.current !== undefined) flush(true)
      else { void queueVersion(project(), 'checkpoint'); saveView() }
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onHidden)
      window.clearTimeout(timer.current)
      window.clearTimeout(viewTimer.current)
      window.clearTimeout(mirrorTimer.current)
      window.clearTimeout(versionTimer.current)
    }
  }, [flush, project, queueVersion, saveView])

  const setSource = useCallback((source: string) => {
    if (viewSettings.getState().mode === 'visual' || !workspace.current.activeId || restoring.current) return
    fileRef.current = { ...fileRef.current, source }
    queueEdit('source')
  }, [queueEdit, workspace, viewSettings])

  function switchMode(mode: EditorMode, focus = true) {
    const previous = viewSettings.getState().mode
    if (!editor || !session.current || mode === previous || restoring.current) return
    try {
      const next = project()
      const view = sourceView.current
      const direct = previous !== 'split' && mode !== 'split'
      const matched = synchronize(direct, !direct || !!issue.current)
      let pane = mode === 'split' ? active.current : mode
      if (!matched && mode === 'split') pane = 'source'
      let caret: number | undefined
      if (direct && matched) {
        const projection = parseSource(next.source)
        caret = pane === 'source'
          ? visualToSource(editor.state.doc, editor.state.selection.head, projection)
          : sourceToVisual(projection, view?.state.selection.main.head ?? 0, editor.state.doc)
      }
      window.clearTimeout(mirrorTimer.current)
      replaceFile(next)
      active.current = pane
      setActivePane(pane)
      viewSettings.getState().setMode(mode)
      searchCache.current = {}
      refreshSearch()
      setVisualDirty(false)
      if (timer.current !== undefined) flush()
      else saveView()
      const token = ++transition.current
      if (focus) requestAnimationFrame(() => {
        if (token !== transition.current || next.id !== fileRef.current.id || viewSettings.getState().mode !== mode) return
        if (pane === 'source' && view) {
          if (caret !== undefined) view.dispatch({ selection: { anchor: Math.min(caret, view.state.doc.length) }, scrollIntoView: true })
          view.focus()
        } else if (!issue.current) {
          const { state } = editor
          if (caret !== undefined) {
            const selection = Selection.near(state.doc.resolve(Math.min(caret, state.doc.content.size)))
            if (!state.selection.eq(selection)) editor.view.dispatch(state.tr.setSelection(selection).setMeta('addToHistory', false).scrollIntoView())
          }
          editor.view.focus()
        }
        saveView()
      })
    } catch (error) { notify(errorMessage(error)) }
  }

  function applySearch(model: SearchDocument, scope: SearchScope, hits: SearchHit[], value: string, regex: boolean) {
    if (!editor || !canEdit() || model.id !== workspace.current.activeId || model.revision !== editVersion.current || project().source !== model.session.source) {
      throw new Error('The document changed. Wait for the updated search results.')
    }
    const result = replaceSearchHits(model, scope, hits, value, regex)
    if (result.source === model.session.source) return result
    const mode = viewSettings.getState().mode
    const useSource = scope === 'source' || mode === 'source' || (mode === 'split' && (active.current === 'source' || issue.current))
    if (useSource) {
      if (mode === 'visual') switchMode('source', false)
      const view = sourceView.current
      if (!view) throw new Error('The Markdown editor is still opening.')
      if (view.state.doc.toString() !== model.session.source) synchronize(false, false)
      if (view.state.doc.toString() !== model.session.source) throw new Error('The Markdown editor is still catching up.')
      if (mode === 'split') { active.current = 'source'; setActivePane('source') }
      replaceSource(view, result.source, 'search')
      if (mode === 'split') synchronize(false, true)
    } else {
      if (mode === 'split' && !synchronize(false, true)) throw new Error('Switch to Markdown Source to edit the incomplete draft.')
      const transaction = closeHistory(editor.state.tr).setMeta('preventUpdate', true)
      applyRenderedHits(transaction, hits, value, regex, searchVisualOffsets(model, editor.state.doc))
      remember(editor.state.doc, model.session.source)
      editor.view.dispatch(transaction)
      editor.view.dispatch(closeHistory(editor.state.tr))
      remember(editor.state.doc, result.source)
      queueEdit('visual')
      if (mode === 'split') synchronize(false, true)
    }
    return result
  }

  function displayFile(next: DocumentFile, created = false) {
    if (!editor || restoring.current) throw new Error('Wait for the current document operation to finish.')
    if (workspace.current.activeId === next.id) return
    const outgoing = stashTab()
    const current = workspace.current
    const view = current.tabs.find(tab => tab.id === next.id) ?? current.closed.find(tab => tab.id === next.id) ?? { id: next.id, mode: 'visual' as const }
    if (created) {
      const words = documentInfo(openMarkdown(next.source, editor.schema).document).statistics.words
      void persistDraft(next, 'checkpoint', words, true)
    } else void queueVersion(next, 'checkpoint')
    void opened(next.id)?.catch(() => undefined)
    const tabs = current.tabs.map(tab => tab.id === outgoing?.id ? outgoing : tab)
    if (!tabs.some(tab => tab.id === next.id)) tabs.push(view)
    saveLayout({ activeId: next.id, tabs, closed: current.closed.filter(tab => tab.id !== next.id) })
    showTab(next, view)
  }

  async function openDocument(id: string) {
    const intent = ++openIntent.current
    if (workspace.current.activeId === id) return
    const previous = drafts.current.get(id)
    const next = previous ?? await loadFile(id)
    if (intent !== openIntent.current) return
    if (!next || documents.current.get(id)?.deletedAt !== undefined) throw new Error('This document is unavailable.')
    displayFile(next)
  }

  function createDocument() {
    openIntent.current++
    displayFile(newDocument(availableTitle('Untitled document', documents.current.values())), true)
  }

  async function renameDocument(id: string, title: string) {
    const nextTitle = title.trim().slice(0, 155) || 'Untitled document'
    const stored = drafts.current.get(id) ?? await loadFile(id)
    if (!stored) throw new Error('This document could not be found.')
    const current = workspace.current.activeId === id ? project() : stored
    if (current.title === nextTitle) return
    const next = { ...current, title: nextTitle, updated: Math.max(Date.now(), current.updated + 1) }
    if (workspace.current.activeId === id) replaceFile(next)
    await persistDraft(next)
    if (!workspace.current.tabs.some(tab => tab.id === id)) forget(id)
  }

  async function duplicateDocument(id: string) {
    const intent = ++openIntent.current
    const original = workspace.current.activeId === id ? project() : await loadFile(id)
    if (!original) throw new Error('This document could not be found.')
    const { source, lineEnding, bom, original: encoding } = original
    const extension = /\.(md|markdown)$/i.exec(original.title)?.[0] ?? ''
    const stem = extension ? original.title.slice(0, -extension.length) : original.title
    const copy = newDocument(availableTitle(stem + ' copy' + extension, documents.current.values()), { source, bom, lineEnding, original: encoding })
    if (intent === openIntent.current) displayFile(copy, true)
    else await persistDraft(copy, 'checkpoint', undefined, true)
    if (!workspace.current.tabs.some(tab => tab.id === id)) forget(id)
  }

  async function removeTabs(ids: Set<string>, deleting?: string) {
    if (restoring.current) throw new Error('Wait for the current document operation to finish.')
    openIntent.current++
    const before = workspace.current
    const wasActive = before.activeId !== null && ids.has(before.activeId)
    if (!wasActive && timer.current !== undefined) flush()
    const view = wasActive ? stashTab() : captureView()
    restoring.current = true
    try {
      await writing.current
      for (const id of ids) if (saveStatusRef.current.get(id) === 'unavailable') throw new Error('This draft could not be saved locally. Keep its tab open and download a copy of your changes.')
      const next = withoutTabs({ ...before, tabs: before.tabs.map(tab => tab.id === view?.id ? view : tab) }, ids, !deleting)
      const successor = wasActive ? next.tabs.find(tab => tab.id === next.activeId) : undefined
      const file = successor ? await loadFile(successor.id) : undefined
      if (successor && !file) throw new Error('The next document could not be opened.')
      if (deleting) {
        updateSummary(await enqueue(() => storage.trashDocument(deleting)))
        saveLayout(next)
      } else await changeLayout(next, true)
      if (successor && file) {
        void opened(file.id)?.catch(() => undefined)
        showTab(file, successor)
      } else if (wasActive) {
        transition.current++
        session.current = null
        parsed.current = null
        paired.current = null
        anchors.current = null
        cache.current = null
        history.current = []
        pendingScroll.current = undefined
        initialView.current = undefined
        if (editor) editor.view.updateState(EditorState.create({ schema: editor.schema, plugins: editor.state.plugins }))
        sourceRuntime.current?.apply('')
        replaceFile(newDocument())
        setInfo(emptyInfo)
        setMetadata('')
        setIssue(null)
        viewSettings.getState().setMode('visual')
        setStatus('saved')
        setVisualDirty(false)
        setEditorEpoch(value => value + 1)
      }
      for (const id of ids) {
        tabSessions.current.delete(id)
        forget(id)
        if (deleting) fileHandles.current.delete(id)
      }
    } finally { restoring.current = false }
  }

  function closeTab(id: string) { return removeTabs(new Set([id])) }
  function closeOtherTabs(id: string) { return removeTabs(new Set(workspace.current.tabs.filter(tab => tab.id !== id).map(tab => tab.id))) }
  function deleteDocument(id: string) { return removeTabs(new Set([id]), id) }
  function reopenTab() {
    const previous = workspace.current.closed[0]
    return previous ? openDocument(previous.id) : Promise.resolve()
  }
  async function restoreDocument(id: string) {
    updateSummary(await enqueue(() => storage.recoverDocument(id)))
  }

  async function importFile(input: FileInput) {
    if (!/\.(md|markdown)$/i.test(input.name)) { notify('Choose a .md or .markdown file.'); return }
    try {
      const decoded = await files.readMarkdown(input)
      const title = availableTitle(input.name.replace(/\.md$/i, ''), documents.current.values())
      openIntent.current++
      displayFile(newDocument(title, decoded), true)
      notify('Opened ' + input.name)
    } catch (error) { notify('Could not open the UTF-8 file. ' + errorMessage(error)) }
  }

  async function save(options: { saveAs?: boolean; download?: boolean } = {}) {
    try {
      if (!workspace.current.activeId) return
      const next = project()
      const result = await files.saveMarkdown(next, next.title, { ...options, handle: fileHandles.current.get(next.id) })
      if (result.handle) fileHandles.current.set(next.id, result.handle)
      if (!options.download && !restoring.current) {
        const stored = next.id === workspace.current.activeId ? undefined : await loadFile(next.id)
        const current = next.id === workspace.current.activeId ? project() : drafts.current.get(next.id) ?? stored
        if (current && current.historyEpoch === next.historyEpoch && documents.current.get(next.id)?.deletedAt === undefined) {
          const updated = { ...current, savedSource: next.source, savedTitle: next.title, updated: Math.max(Date.now(), current.updated + 1) }
          if (workspace.current.activeId === next.id) replaceFile(updated)
          await persistDraft(updated)
          if (!workspace.current.tabs.some(tab => tab.id === next.id)) forget(next.id)
        }
      }
      notify(result.handle ? 'Saved to ' + result.filename : 'Downloaded ' + result.filename)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('Could not save the file. ' + errorMessage(error))
    }
  }

  const loadVersions = useCallback((id: string) => writing.current.then(() => storage.listVersions(id)), [storage, writing])

  async function createVersion() {
    const current = project()
    const result = await enqueue(() => storage.recordVersion(current, 'manual'))
    if (fileRef.current.id === current.id) setHistoryError('')
    return result
  }

  async function restoreHistoryVersion(version: DocumentVersion) {
    if (!editor || restoring.current) return
    const current = project()
    if (current.id !== version.documentId) throw new Error('This version belongs to another document.')
    const baseline = openMarkdown(version.content.source, editor.schema)
    const pending = timer.current !== undefined
    window.clearTimeout(timer.current)
    timer.current = undefined
    restoring.current = true
    openIntent.current++
    const words = documentInfo(baseline.document).statistics.words
    const commit = enqueue(() => storage.restoreVersion(current, version.id, persisted.current.get(current.id), words))
    try {
      const next = await commit
      window.clearTimeout(mirrorTimer.current)
      window.clearTimeout(versionTimer.current)
      versionTimer.current = undefined
      editVersion.current++
      revision.current.set(next.id, (revision.current.get(next.id) ?? 0) + 1)
      transition.current++
      history.current = []
      authority.current = 'visual'
      setIssue(null)
      applySession(baseline)
      replaceFile(next)
      sourceRuntime.current?.apply(next.source)
      cacheFile(next, words)
      persisted.current.set(next.id, next)
      tabSessions.current.delete(next.id)
      saveView()
      setEditorEpoch(value => value + 1)
      setVisualDirty(false)
      setHistoryError('')
      markStatus(next.id, 'saved')
    } catch (error) {
      if (pending) schedule()
      throw error
    } finally {
      restoring.current = false
    }
  }

  function changeTitle(title: string) {
    if (!canEdit()) return
    const normalized = title.trim() || 'Untitled document'
    if (normalized === fileRef.current.title) return
    replaceFile({ ...fileRef.current, title: normalized })
    schedule()
  }

  function changeMetadata(value: string) {
    if (!editor) return
    try {
      if (active.current === 'source') {
        if (!activatePane('source')) return
        const current = project()
        const updated = setFrontMatter(openMarkdown(current.source, editor.schema), value)
        if (updated === current.source) return
        replaceSource(sourceView.current, updated, 'metadata')
        if (fileRef.current.source !== updated) setSource(updated)
        setMetadata(value)
      } else {
        if (!activatePane('visual')) return
        if (editor.state.doc.attrs.frontMatter === value) return
        editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('frontMatter', value))
        editor.view.dispatch(closeHistory(editor.state.tr))
      }
    } catch (error) { notify(errorMessage(error)) }
  }

  const scrollAnchors = useCallback(() => {
    const pair = paired.current
    if (!pair || pair.version !== editVersion.current || editor?.state.doc !== pair.document) return []
    if (anchors.current?.pair !== pair) anchors.current = { pair, blocks: splitAnchors(pair.document, parseSource(pair.source)) }
    return anchors.current.blocks
  }, [editor, parseSource])

  function jumpToHeading(heading: Heading): BlockAnchor | undefined {
    if (!editor) return
    setActiveHeading(heading.anchor)
    if (viewSettings.getState().mode === 'split') {
      try {
        synchronize(false, true)
        const pair = paired.current
        const current = documentInfo(editor.state.doc).outline.find(item => item.anchor === heading.anchor)
        if (pair && current) {
          const source = visualToSource(editor.state.doc, current.position + 1, parseSource(pair.source))
          return { visual: current.position, source: Math.min(source, sourceView.current?.state.doc.length ?? source) }
        }
      } catch (error) { notify(errorMessage(error)) }
      return
    }
    if (viewSettings.getState().mode === 'source') {
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

  const dirty = visualDirty || file.source !== file.savedSource || file.title !== file.savedTitle
  const tabs = collection.layout.tabs.map(tab => {
    const summary = documents.current.get(tab.id)
    const current = tab.id === collection.layout.activeId
    return { ...tab, title: current ? file.title : summary?.title ?? 'Untitled document', dirty: current ? dirty : Boolean(summary?.dirty), status: saveStatuses[tab.id] }
  })
  const recent = collection.library.filter(item => item.openedAt !== undefined && item.deletedAt === undefined).sort((first, second) => second.openedAt! - first.openedAt!).slice(0, 15)

  return {
    editor, file, recent, status, sourceView, registerSource, setSource, canEdit, trackView, info, metadata, warnings, activeHeading,
    activePane, activatePane, previewIssue, scrollAnchors,
    dirty, tabs, library: collection.library, layout: collection.layout,
    editorEpoch, historyError, loadVersions, createVersion, restoreHistoryVersion,
    captureSearch, subscribeSearch, presentSearch, applySearch, clearSearch,
    project, switchMode, createDocument, openDocument, renameDocument, duplicateDocument, deleteDocument, restoreDocument, closeTab, closeOtherTabs, reopenTab,
    importFile, save, changeTitle, changeMetadata, jumpToHeading,
  }
}
