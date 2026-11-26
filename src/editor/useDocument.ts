import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useEditor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { EditorState, Plugin, Selection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@codemirror/view'
import type { EditorState as SourceState } from '@codemirror/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { createExtensions } from './schema'
import { nodeViewExtensions, workspaceImageExtension } from './nodeViews'
import { replaceSource, type SourceRuntime } from './SourceEditor'
import { useDocumentCollection } from './useDocumentCollection'
import { sourceToVisual, visualToSource } from './markdownSelection'
import { validateSource } from './sourceDiagnostics'
import { visualProjection } from './visualProjection'
import { applyRenderedHits, replaceSearchHits, richSearchDocument, searchDocument, searchSource, searchVisualOffsets, type SearchDocument, type SearchHit, type SearchScope } from './documentSearch'
import { highlightSourceSearch, highlightVisualSearch, VisualSearchDecorations } from './searchDecorations'
import { splitAnchors, type BlockAnchor } from './splitScroll'
import { openMarkdown, rebaseMarkdown, setFrontMatter, writeMarkdown, type MarkdownSession } from '../document/markdown'
import type { WritableMarkdownHandle } from '../document/files'
import { makeDocxContent, newTextContent, originalReference, sameContent, spreadsheetContent, type DocxContent, type DocumentContent, type DocumentFormat, type LineEnding } from '../document/formats/content'
import { canonicalDocx, docxMaxWorkspaceSnapshot, docxMimeType, docxText, readDocxSnapshot } from '../document/formats/docx/model'
import { exportDocument, importDocument, originalFileBytes, spreadsheetMediaTypes, type ExportSnapshot } from '../document/formats/registry'
import { createWorkbook, type CsvDialect, type Workbook } from '../document/formats/spreadsheet/model'
import { WorkspaceRestoreConflict, type FileInput, type FolioHost, type LiveDocumentSnapshot } from '../host/contracts'
import { documentInfo, plainDocumentInfo, type Heading } from '../document/metadata'
import { availableTitle, draftSummary, emptyLayout, newDocument, welcomeSource, withoutTabs, type DocumentFile, type EditorMode, type EditorPane, type TabView, type WorkspaceLayout, type WorkspaceView } from '../document/workspace'
import { versionInterval, versionStorageError, type DocumentVersion, type VersionTrigger } from '../document/versions'

type LocalStatus = 'loading' | 'pending' | 'saved' | 'unavailable'
const emptyInfo = { outline: [], statistics: { words: 0, characters: 0, compact: 0, minutes: 0, headings: 0, links: 0, images: 0 } }

interface TabSession {
  state?: EditorState
  source?: SourceState
  markdown: MarkdownSession | null
  authority: EditorPane
  issue: string | null
  history: { document: ProseMirrorNode; source: string }[]
  paired: { source: string; document: ProseMirrorNode } | null
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

export function useDocument(notify: (message: string) => void, visualScroll: RefObject<HTMLDivElement | null>, { storage, files, docx, pdf, workspaceDocx, liveDocument, resources }: FolioHost, viewSettings: WorkspaceView) {
  const collection = useDocumentCollection(storage)
  const { workspace, documents, drafts, persisted, writing, enqueue, changeLayout, loadCollection, loadFile, persist, insertImported, cache: cacheFile, opened, updateSummary, forget } = collection
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
  const [liveState, setLiveState] = useState<LiveDocumentSnapshot>()
  const liveReadOnly = useRef(false)
  const liveSource = useRef<string>(undefined)
  const fileRef = useRef(file)
  const tabSessions = useRef(new Map<string, TabSession>())
  const workbookHistory = useRef(new Map<string, { undo: Workbook[]; redo: Workbook[] }>())
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
  const richProjection = useRef<{ node: ProseMirrorNode; content: Pick<DocxContent, 'document' | 'source'> }>(undefined)
  const history = useRef<{ document: ProseMirrorNode; source: string }[]>([])
  const fileHandles = useRef(new Map<string, WritableMarkdownHandle>())
  const visualUpdate = useRef<() => void>(() => {})
  const selectionUpdate = useRef<() => void>(() => {})
  const timer = useRef<number | undefined>(undefined)
  const viewTimer = useRef<number | undefined>(undefined)
  const versionTimer = useRef<number | undefined>(undefined)
  const mirrorTimer = useRef<number | undefined>(undefined)
  const summaryTimer = useRef<number | undefined>(undefined)
  const editVersion = useRef(0)
  const revision = useRef(new Map<string, number>())
  const saveStatusRef = useRef(new Map<string, LocalStatus>())
  const transition = useRef(0)
  const openIntent = useRef(0)
  const importing = useRef<AbortController>(undefined)
  const restoring = useRef(false)
  const searchCache = useRef<Partial<Record<SearchScope, SearchDocument>>>({})
  const searchListeners = useRef(new Set<() => void>())
  const canEdit = useCallback(() => !!workspace.current.activeId && !restoring.current && !liveReadOnly.current, [workspace])
  const refreshSearch = useCallback(() => { for (const listener of searchListeners.current) listener() }, [])
  const subscribeSearch = useCallback((listener: () => void) => {
    searchListeners.current.add(listener)
    return () => { searchListeners.current.delete(listener) }
  }, [])

  const editor = useEditor({
    extensions: [...createExtensions(resources ? [...nodeViewExtensions, workspaceImageExtension(resources)] : nodeViewExtensions), VisualSearchDecorations, Extension.create({
      name: 'workspaceEditing',
      addProseMirrorPlugins: () => [new Plugin({ filterTransaction: transaction => {
        if (!transaction.docChanged || transaction.getMeta('folio.host') === true) return true
        if (!canEdit()) return false
        if (fileRef.current.format !== 'docx') return true
        try {
          const document = canonicalDocx(transaction.doc.toJSON())
          if (workspaceDocx && JSON.stringify(document).length > docxMaxWorkspaceSnapshot) throw new Error('The DOCX draft exceeds Folio’s workspace editing limit.')
          richProjection.current = { node: transaction.doc, content: { document, source: docxText(document) } }
          return true
        } catch (error) { notify(errorMessage(error)); return false }
      } })],
    })],
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { 'aria-label': 'Visual document editor', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' } },
    onUpdate: () => visualUpdate.current(),
    onSelectionUpdate: () => selectionUpdate.current(),
  })

  const project = useCallback(() => {
    const baseline = session.current
    const file = fileRef.current
    if (file.format === 'pdf' || 'workbook' in file) return file
    if (file.format === 'docx' && editor) {
      const node = editor.state.doc
      if (richProjection.current?.node !== node) {
        const document = canonicalDocx(node.toJSON())
        richProjection.current = { node, content: { document, source: docxText(document) } }
      }
      return { ...file, ...richProjection.current.content }
    }
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

  const applyRichDocument = useCallback((node: ProseMirrorNode, savedState?: EditorState) => {
    if (!editor) return
    const state = savedState ?? EditorState.create({ schema: editor.schema, doc: node, plugins: editor.state.plugins })
    editor.view.updateState(state)
    richProjection.current = undefined
    session.current = null
    paired.current = null
    setInfo(documentInfo(state.doc))
    setActiveHeading('')
    setMetadata('')
    setWarnings(0)
  }, [editor])

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
    if (liveDocument) return
    const view = captureView()
    if (view) saveLayout({ ...workspace.current, tabs: workspace.current.tabs.map(tab => tab.id === view.id ? view : tab) })
  }, [captureView, liveDocument, saveLayout, workspace])

  const trackView = useCallback(() => {
    if (liveDocument) return
    const id = workspace.current.activeId
    if (!id || restoring.current || pendingScroll.current?.id === id) return
    window.clearTimeout(viewTimer.current)
    viewTimer.current = window.setTimeout(() => {
      if (!restoring.current && workspace.current.activeId === id) saveView()
    }, 350)
  }, [liveDocument, saveView, workspace])

  const automaticVersion = useCallback(async (candidate: DocumentFile, trigger: Exclude<VersionTrigger, 'manual'>) => {
    // Imported PDFs are read-only, so their immutable original is the only revision.
    if (candidate.format === 'pdf') return
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
    if (!editor || !workspace.current.activeId || restoring.current) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    try {
      const projected = project()
      const next = { ...projected, updated: Math.max(Date.now(), projected.updated + 1) }
      replaceFile(next)
      setVisualDirty(false)
      const plain = next.format === 'txt' ? plainDocumentInfo(next.source) : undefined
      const words = 'workbook' in next ? undefined : plain?.statistics.words ?? documentInfo(authority.current === 'source' ? parseSource(next.source).document : editor.state.doc).statistics.words
      const saved = persistDraft(next, checkpoint ? 'checkpoint' : 'interval', words)
      saveView()
      if ('workbook' in next) return saved
      if (plain) setInfo(plain)
      else if (viewSettings.getState().mode === 'source' && !issue.current) summarize(parseSource(next.source))
      else if (!issue.current) {
        setInfo(documentInfo(editor.state.doc))
        let count = 0
        editor.state.doc.descendants(node => { if (node.type.name === 'rawBlock' || node.type.name === 'rawInline') count++ })
        setWarnings(count)
      }
      return saved
    } catch (error) {
      setStatus('unavailable')
      notify(errorMessage(error))
    }
  }, [editor, notify, parseSource, persistDraft, project, replaceFile, saveView, summarize, viewSettings, workspace])

  const scheduleVersionCheck = useCallback(function checkLater(delay: number) {
    const id = fileRef.current.id
    versionTimer.current = window.setTimeout(() => {
      versionTimer.current = undefined
      if (restoring.current || fileRef.current.id !== id) return
      if (timer.current !== undefined) void flush()
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
    timer.current = window.setTimeout(() => { void flush() }, 480)
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

  const applySession = useCallback((baseline: MarkdownSession, update: 'reset' | 'history' | 'mirror' | 'host' = 'reset') => {
    if (!editor) return
    const oldState = editor.state
    if (update !== 'reset') {
      baseline = rebaseMarkdown(baseline, oldState.doc)
      const transaction = visualProjection(oldState, baseline.document, update === 'history')
      if (update === 'host') transaction.setMeta('folio.host', true)
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
    if (wasPaused !== Boolean(message)) editor?.setEditable(!message && !liveReadOnly.current, false)
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
      const sourceChanged = replaceSource(sourceView.current, next.source, 'visual', recordHistory)
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
    if (liveDocument) {
      try {
        // setSource already received the serialized CodeMirror document for this transaction.
        const current = origin === 'source' ? fileRef.current : project()
        const source = current.format === 'docx' ? JSON.stringify(current.document) : current.source
        liveSource.current = source
        liveDocument.edit(source)
        window.clearTimeout(summaryTimer.current)
        summaryTimer.current = window.setTimeout(() => {
          if (version !== editVersion.current) return
          if (current.format === 'txt') setInfo(plainDocumentInfo(source))
          else if (current.format === 'docx' && editor) setInfo(documentInfo(editor.state.doc))
          else summarize(parseSource(source))
        }, 300)
      } catch (error) { notify(errorMessage(error)) }
    } else {
      setVisualDirty(true)
      schedule()
    }
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
  }, [editor, liveDocument, notify, parseSource, project, refreshSearch, schedule, setIssue, summarize, synchronize, viewSettings])

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

  const showTab = useCallback((next: DocumentFile, view: TabView, plainInfo?: ReturnType<typeof plainDocumentInfo>) => {
    if (!editor) return
    const resumed = tabSessions.current.get(next.id)
    tabSessions.current.delete(next.id)
    const baseline = next.format === 'txt' || next.format === 'docx' || next.format === 'pdf' || 'workbook' in next ? null : resumed?.markdown ?? openMarkdown(next.source, editor.schema)
    if (next.format === 'txt') view = { ...view, mode: 'source' }
    if (next.format === 'docx' || next.format === 'pdf' || 'workbook' in next) view = { ...view, mode: 'visual' }
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
    if (next.format === 'docx') {
      const node = resumed?.state?.doc ?? editor.schema.nodeFromJSON(next.document)
      applyRichDocument(node, resumed?.state)
      if (!resumed?.state && view.visual) {
        const { doc, tr } = editor.state
        editor.view.dispatch(tr.setSelection(TextSelection.between(doc.resolve(Math.min(view.visual.anchor, doc.content.size)), doc.resolve(Math.min(view.visual.head, doc.content.size)))).setMeta('addToHistory', false))
      }
    } else if (next.format === 'pdf' || 'workbook' in next) {
      // The dedicated surface owns the document content.
      editor.view.updateState(EditorState.create({ schema: editor.schema, plugins: editor.state.plugins }))
      session.current = null
      paired.current = null
      setInfo(emptyInfo)
      setActiveHeading('')
      setMetadata('')
      setWarnings(0)
    } else if (!baseline) {
      session.current = null
      paired.current = null
      setInfo(plainInfo ?? plainDocumentInfo(next.source))
      setActiveHeading('')
      setMetadata('')
      setWarnings(0)
    } else if (resumed?.state) {
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
    if (baseline && view.mode === 'source') summarize(openMarkdown(next.source, editor.schema))
    else if (baseline && resumed) {
      summarize(baseline, editor.state.doc)
      setMetadata(editor.state.doc.attrs.frontMatter ?? '')
      let preserved = 0
      editor.state.doc.descendants(node => { if (node.type.name === 'rawBlock' || node.type.name === 'rawInline') preserved++ })
      setWarnings(preserved)
    }
    if (sourceRuntime.current && next.format !== 'docx' && next.format !== 'pdf' && !('workbook' in next)) {
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
  }, [applyRichDocument, applySession, applySourceSelection, editor, refreshSearch, replaceFile, restoreScroll, setIssue, summarize, viewSettings])

  const clearSearch = useCallback(() => {
    searchCache.current = {}
    if (editor && !editor.isDestroyed) highlightVisualSearch(editor, [])
    if (sourceView.current) highlightSourceSearch(sourceView.current, [])
  }, [editor])

  const captureSearch = useCallback((scope: SearchScope) => {
    const id = workspace.current.activeId
    if (!id || !editor) return
    const cached = searchCache.current[scope]
    if (cached?.id === id && cached.revision === editVersion.current) return cached
    if (fileRef.current.format === 'docx') {
      const snapshot = richSearchDocument(id, editVersion.current, editor.state.doc)
      searchCache.current[scope] = snapshot
      return snapshot
    }
    const source = project().source
    if (fileRef.current.format === 'txt') {
      const snapshot: SearchDocument = { format: 'txt', id, revision: editVersion.current, source, canReplace: true }
      searchCache.current[scope] = snapshot
      return snapshot
    }
    if (!session.current) return
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
    if (model.format === 'txt') {
      if (view && view.state.doc.toString() === model.source) {
        const ranges = hits.flatMap((hit, index) => hit.source.map(range => ({ ...range, current: index === current })))
        highlightSourceSearch(view, ranges, scroll ? selected?.source[0]?.from : undefined)
      }
      return
    }
    const sourceCurrent = model.format === 'markdown' && !!view && mode !== 'visual' && view.state.doc.toString() === model.session.source
    const offsets = model.format === 'docx' ? new Map(model.document.eq(editor.state.doc) ? [[0, 0]] : [])
      : mode !== 'source' && (authority.current === 'visual' || paired.current?.source === model.session.source)
        ? searchVisualOffsets(model, editor.state.doc) : new Map<number, number>()
    const sourceRanges = sourceCurrent ? hits.flatMap((hit, index) => hit.source.map(range => ({ ...range, current: index === current }))) : []
    const visualRanges = hits.flatMap((hit, index) => hit.visual.flatMap(range => {
      const offset = offsets.get(range.block)
      return offset === undefined ? [] : [{ from: range.from + offset, to: range.to + offset, current: index === current }]
    }))
    highlightVisualSearch(editor, visualRanges)
    if (view && model.format === 'markdown') {
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
    if (!id || !editor) return
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
    tabSessions.current.set(id, { state: session.current || current.format === 'docx' ? editor.state : undefined, source: sourceView.current?.state, markdown: session.current,
      authority: authority.current, issue: issue.current, history: history.current, paired: paired.current })
    const known = drafts.current.get(id)
    if (pending || !known || !sameContent(current, known) || current.title !== known.title || saveStatusRef.current.get(id) === 'unavailable') {
      const next = { ...current, updated: Math.max(Date.now(), current.updated + 1) }
      const words = 'workbook' in next ? undefined : (next.format === 'txt' ? plainDocumentInfo(next.source) : documentInfo(authority.current === 'source' ? parseSource(next.source).document : editor.state.doc)).statistics.words
      void persistDraft(next, 'checkpoint', words)
      replaceFile(next)
    } else void queueVersion(current, 'checkpoint')
    return captureView()
  }, [captureView, clearSearch, drafts, editor, parseSource, persistDraft, project, queueVersion, replaceFile, synchronize, workspace, viewSettings])

  useEffect(() => {
    if (!editor) return
    if (liveDocument) {
      const receive = (state: LiveDocumentSnapshot) => {
        setLiveState(state)
        const readOnly = !state.available || !!state.readOnly || state.conflict !== undefined
        liveReadOnly.current = readOnly
        if (!state.id) return
        try {
          const text = { source: state.source, lineEnding: state.lineEnding, bom: !!state.bom }
          const content: DocumentContent = state.format === 'txt' ? { ...newTextContent(), ...text }
            : state.format === 'docx' ? makeDocxContent(readDocxSnapshot(state.source), state.issues ?? []) : { ...text, format: 'markdown' }
          const next: DocumentFile = { ...content, id: state.id, title: state.title,
            savedSource: content.source, savedTitle: state.title, updated: Date.now() }
          if (workspace.current.activeId !== next.id) {
            const view: TabView = { id: next.id, mode: next.format === 'txt' ? 'source' : 'visual' }
            loadCollection([draftSummary(next)], { activeId: next.id, tabs: [view], closed: [] })
            showTab(next, view)
          } else {
            if (liveSource.current !== state.source) {
              ++editVersion.current
              window.clearTimeout(mirrorTimer.current)
              window.clearTimeout(summaryTimer.current)
              if (next.format === 'docx') {
                applyRichDocument(editor.schema.nodeFromJSON(next.document))
                refreshSearch()
              } else {
                replaceSource(sourceView.current, next.source, 'host', false)
                if (next.format === 'txt') {
                  setInfo(plainDocumentInfo(next.source))
                  refreshSearch()
                } else {
                  // Native edits can change Markdown delimiters without changing the visual tree.
                  history.current = []
                  authority.current = 'source'
                  const diagnostic = validateSource(next.source)[0]
                  if (diagnostic) {
                    setIssue(diagnostic.message)
                    summarize(parseSource(next.source))
                    refreshSearch()
                  } else {
                    applySession(parseSource(next.source), 'host')
                    setIssue(null)
                  }
                }
              }
            }
            replaceFile(next)
          }
          liveSource.current = state.source
          const editable = !readOnly && !issue.current
          if (editor.isEditable !== editable) editor.setEditable(editable, false)
          setStatus(readOnly ? 'unavailable' : state.pending ? 'pending' : 'saved')
        } catch (error) {
          setStatus('unavailable')
          notify(errorMessage(error))
        }
      }
      receive(liveDocument.read())
      return liveDocument.subscribe(receive)
    }
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
  }, [editor, applyRichDocument, applySession, cacheFile, liveDocument, loadCollection, loadFile, markStatus, notify, opened, parseSource, persistDraft, queueVersion, refreshSearch, replaceFile, saveLayout, setIssue, showTab, storage, summarize, workspace])

  useEffect(() => {
    const onHidden = (event: Event) => {
      if (liveDocument) return
      if (restoring.current || !workspace.current.activeId || (event.type !== 'pagehide' && document.visibilityState !== 'hidden')) return
      if (timer.current !== undefined) void flush(true)
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
      window.clearTimeout(summaryTimer.current)
      window.clearTimeout(versionTimer.current)
      importing.current?.abort()
    }
  }, [flush, liveDocument, project, queueVersion, saveView, workspace])

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
      if (timer.current !== undefined) void flush()
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
    if (!editor || !canEdit() || model.id !== workspace.current.activeId || model.revision !== editVersion.current) {
      throw new Error('The document changed. Wait for the updated search results.')
    }
    if (model.format === 'docx') {
      if (!model.document.eq(editor.state.doc)) throw new Error('The document changed. Wait for the updated search results.')
      const transaction = closeHistory(editor.state.tr).setMeta('preventUpdate', true)
      const result = applyRenderedHits(transaction, hits, value, regex)
      if (transaction.docChanged) {
        // Validate before dispatch so the find panel can report a rejected replacement.
        canonicalDocx(transaction.doc.toJSON())
        editor.view.dispatch(transaction)
        editor.view.dispatch(closeHistory(editor.state.tr))
        queueEdit('visual')
      }
      return result
    }
    const original = searchSource(model)
    if (project().source !== original) throw new Error('The document changed. Wait for the updated search results.')
    const result = replaceSearchHits(model, scope, hits, value, regex)
    if (result.source === original) return result
    if (model.format === 'txt') {
      if (!sourceView.current || sourceView.current.state.doc.toString() !== original) throw new Error('The plain text editor is still catching up.')
      replaceSource(sourceView.current, result.source, 'search')
      return result
    }
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

  function displayFile(next: DocumentFile, created = false, plainInfo?: ReturnType<typeof plainDocumentInfo>) {
    if (!editor || restoring.current) throw new Error('Wait for the current document operation to finish.')
    if (workspace.current.activeId === next.id) return
    const outgoing = stashTab()
    const current = workspace.current
    const view: TabView = current.tabs.find(tab => tab.id === next.id) ?? current.closed.find(tab => tab.id === next.id) ?? { id: next.id, mode: next.format === 'txt' ? 'source' : 'visual' }
    if (created) {
      const words = 'workbook' in next ? undefined : next.format === 'pdf' ? 0 : (next.format === 'txt' ? plainDocumentInfo(next.source) : documentInfo(
        next.format === 'docx' ? editor.schema.nodeFromJSON(next.document) : openMarkdown(next.source, editor.schema).document)).statistics.words
      void persistDraft(next, 'checkpoint', words, true)
    } else void queueVersion(next, 'checkpoint')
    void opened(next.id)?.catch(() => undefined)
    const tabs = current.tabs.map(tab => tab.id === outgoing?.id ? outgoing : tab)
    if (!tabs.some(tab => tab.id === next.id)) tabs.push(view)
    saveLayout({ activeId: next.id, tabs, closed: current.closed.filter(tab => tab.id !== next.id) })
    showTab(next, view, plainInfo)
  }

  function nextOpenIntent() {
    importing.current?.abort()
    return ++openIntent.current
  }

  async function openDocument(id: string) {
    const intent = nextOpenIntent()
    if (workspace.current.activeId === id) return
    const previous = drafts.current.get(id)
    const next = previous ?? await loadFile(id)
    if (intent !== openIntent.current) return
    if (!next || documents.current.get(id)?.deletedAt !== undefined) throw new Error('This document is unavailable.')
    displayFile(next)
  }

  function createDocument(format: Exclude<DocumentFormat, 'docx' | 'pdf'> = 'markdown') {
    nextOpenIntent()
    if (format === 'xlsx' || format === 'csv') {
      const title = availableTitle('Untitled.' + format, documents.current.values())
      displayFile(newDocument(title, spreadsheetContent(format, createWorkbook(format))), true)
      return
    }
    const title = availableTitle(format === 'txt' ? 'Untitled.txt' : 'Untitled document', documents.current.values())
    displayFile(newDocument(title, format === 'txt' ? newTextContent() : undefined), true)
  }

  async function renameDocument(id: string, title: string) {
    const nextTitle = title.trim().slice(0, 155) || 'Untitled document'
    const stored = drafts.current.get(id) ?? await loadFile(id)
    if (!stored) throw new Error('This document could not be found.')
    const current = workspace.current.activeId === id ? project() : stored
    if (current.title === nextTitle) return
    const next = { ...current, title: nextTitle, updated: Math.max(Date.now(), current.updated + 1) }
    if (workspace.current.activeId === id) {
      replaceFile(next)
      if (next.format === 'txt' || next.format === 'docx' || next.format === 'pdf' || 'workbook' in next) { editVersion.current++; refreshSearch() }
    }
    await persistDraft(next)
    if (!workspace.current.tabs.some(tab => tab.id === id)) forget(id)
  }

  async function duplicateDocument(id: string) {
    const intent = nextOpenIntent()
    const original = workspace.current.activeId === id ? project() : await loadFile(id)
    if (!original) throw new Error('This document could not be found.')
    const { source, lineEnding, bom, original: encoding } = original
    const extensionPattern = 'workbook' in original ? /\.(xlsx|csv)$/i : original.format === 'txt' ? /\.txt$/i : original.format === 'docx' ? /\.docx$/i : original.format === 'pdf' ? /\.pdf$/i : /\.(md|markdown)$/i
    const extension = extensionPattern.exec(original.title)?.[0] ?? ''
    const stem = extension ? original.title.slice(0, -extension.length) : original.title
    const copy = newDocument(availableTitle(stem + ' copy' + extension, documents.current.values()), original.format === 'pdf'
      ? { format: 'pdf', schemaVersion: 1, pageCount: original.pageCount, features: original.features, pdfTitle: original.pdfTitle, source: '', lineEnding: '\n', bom: false, originalFile: original.originalFile }
      : original.format === 'docx'
      ? { format: 'docx', schemaVersion: 1, source, lineEnding: '\n', bom: false, document: original.document, issues: original.issues, originalFile: original.originalFile }
      : original.format === 'txt'
      ? { format: 'txt', schemaVersion: original.schemaVersion, source, bom, lineEnding, mixedLineEndings: original.mixedLineEndings, originalFile: original.originalFile }
      : 'workbook' in original
      ? { ...spreadsheetContent(original.format, original.workbook), originalFile: original.originalFile }
      : { source, bom, lineEnding, original: encoding })
    if (intent === openIntent.current) displayFile(copy, true)
    else await persistDraft(copy, 'checkpoint', undefined, true)
    if (!workspace.current.tabs.some(tab => tab.id === id)) forget(id)
  }

  async function removeTabs(ids: Set<string>, deleting?: string) {
    if (restoring.current) throw new Error('Wait for the current document operation to finish.')
    nextOpenIntent()
    const before = workspace.current
    const wasActive = before.activeId !== null && ids.has(before.activeId)
    if (!wasActive && timer.current !== undefined) void flush()
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
        workbookHistory.current.delete(id)
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
    if (!editor || liveDocument || restoring.current) return
    const intent = nextOpenIntent()
    const controller = new AbortController()
    importing.current = controller
    const isCurrent = () => openIntent.current === intent && !restoring.current && !controller.signal.aborted
    try {
      const imported = await importDocument(input, controller.signal, docx, pdf?.inspect)
      if (!isCurrent()) return
      if (imported.status === 'rejected') { notify(imported.diagnostics.map(issue => issue.message).join(' ')); return }
      const title = availableTitle(input.name.replace(/\.md$/i, ''), documents.current.values())
      const next = newDocument(title, imported.content)
      const plain = next.format === 'txt' ? plainDocumentInfo(next.source) : undefined
      const words = 'workbook' in next ? undefined : next.format === 'pdf' ? 0 : plain?.statistics.words ?? documentInfo(next.format === 'docx' ? editor.schema.nodeFromJSON(next.document) : openMarkdown(next.source, editor.schema).document).statistics.words
      try { await insertImported(next, words, imported.original, controller.signal) }
      catch (error) {
        if (isCurrent()) notify('Could not save the imported draft. ' + errorMessage(error))
        return
      }
      if (!isCurrent()) return
      displayFile(next, false, plain)
      notify('Opened ' + input.name)
    } catch (error) {
      if (isCurrent()) notify('Could not open the file. ' + errorMessage(error))
    } finally {
      if (importing.current === controller) importing.current = undefined
    }
  }

  function captureExport(): ExportSnapshot {
    const content = project()
    return { id: content.id, revision: editVersion.current, title: content.title, content, nativeRevision: liveDocument?.read().revision }
  }

  function replaceWorkbook(workbook: Workbook, record = true) {
    const current = fileRef.current
    if (!('workbook' in current) || !canEdit() || current.workbook === workbook) return
    if (record) {
      const history = workbookHistory.current.get(current.id) ?? { undo: [], redo: [] }
      history.undo = [...history.undo.slice(-11), current.workbook]
      history.redo = []
      workbookHistory.current.set(current.id, history)
    }
    replaceFile({ ...current, workbook })
    editVersion.current++
    schedule()
  }

  function moveWorkbookHistory(direction: 'undo' | 'redo') {
    const current = fileRef.current
    if (!('workbook' in current) || !canEdit()) return
    const history = workbookHistory.current.get(current.id)
    const next = history?.[direction].pop()
    if (!history || !next) return
    history[direction === 'undo' ? 'redo' : 'undo'].push(current.workbook)
    replaceWorkbook(next, false)
  }

  async function changeCsvDialect(delimiter: CsvDialect['delimiter']) {
    const snapshot = captureExport()
    const content = snapshot.content
    if (!('workbook' in content) || content.format !== 'csv' || !content.originalFile || !content.workbook.csv) return
    const bytes = await originalFileBytes(content.originalFile, storage.readOriginal)
    const { readCsvInWorker } = await import('../document/formats/spreadsheet/csvWorker')
    const before = await readCsvInWorker(bytes.slice(), content.workbook.csv.delimiter)
    before.sheets[0].id = content.workbook.sheets[0].id
    before.csv!.header = content.workbook.csv.header
    const unchanged = before.sheets.length === content.workbook.sheets.length &&
      JSON.stringify(before.sheets) === JSON.stringify(content.workbook.sheets)
    if (!unchanged) throw new Error('The CSV draft contains edits. Reopen the original to change its import delimiter.')
    const workbook = await readCsvInWorker(bytes, delimiter)
    if (!isCurrentExport(snapshot)) throw new Error('The document changed. Choose a delimiter again.')
    workbook.sheets[0].id = content.workbook.sheets[0].id
    workbook.csv!.header = content.workbook.csv.header
    workbook.locale = content.workbook.locale
    workbook.timezone = content.workbook.timezone
    replaceWorkbook(workbook)
  }

  /** True while the active document still has the captured editor and native revisions. */
  function isCurrentExport(snapshot: ExportSnapshot) {
    const native = liveDocument?.read()
    return snapshot.id === workspace.current.activeId && snapshot.revision === editVersion.current &&
      (!native || (!native.pending && native.available && native.conflict === undefined && snapshot.nativeRevision === native.revision))
  }

  function exportCopy(snapshot: ExportSnapshot, lineEnding?: LineEnding, signal?: AbortSignal, confirmDocx?: boolean) {
    const native = liveDocument?.read()
    const codec = workspaceDocx && native ? {
      read: async () => { throw new Error('Open a DOCX file through VS Code.') },
      write: async () => {
        if (snapshot.nativeRevision === undefined || native.pending || native.conflict || native.readOnly) {
          throw new Error('Wait for VS Code to acknowledge the current draft and start the export again.')
        }
        return workspaceDocx.file('copy', snapshot.nativeRevision, signal)
      },
    } : docx
    return exportDocument(snapshot, value => value.id === workspace.current.activeId && value.revision === editVersion.current &&
      (!workspaceDocx || value.nativeRevision === liveDocument?.read().revision),
      storage.readOriginal, files.download, { lineEnding, confirmDocx }, signal, codec)
  }

  async function downloadOriginal() {
    const current = project()
    const revision = liveDocument?.read().revision
    if (current.format === 'docx' && workspaceDocx && revision !== undefined) {
      const bytes = await workspaceDocx.file('original', revision)
      files.download(current.title, bytes, docxMimeType)
      notify('Original download requested')
      return
    }
    const reference = originalReference(current)
    if (!reference) return
    const bytes = await originalFileBytes(reference, storage.readOriginal)
    files.download(reference.filename, bytes, 'workbook' in current ? spreadsheetMediaTypes[current.format]
      : current.format === 'docx' ? docxMimeType : current.format === 'pdf' ? 'application/pdf' : 'text/plain;charset=utf-8')
    notify('Original download requested')
  }

  async function save(options: { saveAs?: boolean; download?: boolean } = {}) {
    if (liveDocument) { liveDocument.run('save'); return }
    try {
      if (!workspace.current.activeId) return
      const next = project()
      if (next.format === 'txt' || next.format === 'docx' || next.format === 'pdf' || 'workbook' in next) {
        await flush(true)
        return
      }
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
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const target = originalReference(fileRef.current) || fileRef.current.format === 'txt' || 'workbook' in fileRef.current ? 'draft locally' : 'file'
        notify(`Could not save the ${target}. ` + errorMessage(error))
      }
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
    const plain = version.content.format === 'txt' ? plainDocumentInfo(version.content.source) : undefined
    const rich = version.content.format === 'docx' ? editor.schema.nodeFromJSON(version.content.document) : undefined
    const spreadsheet = 'workbook' in version.content
    const baseline = plain || rich || spreadsheet ? undefined : openMarkdown(version.content.source, editor.schema)
    const pending = timer.current !== undefined
    window.clearTimeout(timer.current)
    timer.current = undefined
    restoring.current = true
    nextOpenIntent()
    const words = spreadsheet ? undefined : plain?.statistics.words ?? documentInfo(rich ?? baseline!.document).statistics.words
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
      authority.current = plain ? 'source' : 'visual'
      setIssue(null)
      if (plain) setInfo(plain)
      else if (rich) applyRichDocument(rich)
      else if (baseline) applySession(baseline)
      replaceFile(next)
      if (!rich && !spreadsheet) sourceRuntime.current?.apply(next.source)
      if (plain || rich) refreshSearch()
      cacheFile(next, words)
      persisted.current.set(next.id, next)
      tabSessions.current.delete(next.id)
      workbookHistory.current.delete(next.id)
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
    if (liveDocument || !canEdit()) return
    const normalized = title.trim() || 'Untitled document'
    if (normalized === fileRef.current.title) return
    replaceFile({ ...fileRef.current, title: normalized })
    if (fileRef.current.format === 'txt' || fileRef.current.format === 'docx' || fileRef.current.format === 'pdf' || 'workbook' in fileRef.current) { editVersion.current++; refreshSearch() }
    schedule()
  }

  function changeMetadata(value: string) {
    if (!editor || !canEdit() || fileRef.current.format === 'txt' || fileRef.current.format === 'docx') return
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

  const dirty = liveState ? liveState.dirty || liveState.pending || liveState.conflict !== undefined
    : file.format === 'txt' || file.format === 'docx' || file.format === 'pdf' || 'workbook' in file ? status === 'pending' || status === 'unavailable' : visualDirty || file.source !== file.savedSource || file.title !== file.savedTitle
  const tabs = collection.layout.tabs.map(tab => {
    const summary = documents.current.get(tab.id)
    const current = tab.id === collection.layout.activeId
    return { ...tab, title: current ? file.title : summary?.title ?? 'Untitled document', dirty: current ? dirty : Boolean(summary?.dirty), status: saveStatuses[tab.id] }
  })
  const recent = collection.library.filter(item => item.openedAt !== undefined && item.deletedAt === undefined).sort((first, second) => second.openedAt! - first.openedAt!).slice(0, 15)
  const currentWorkbookHistory = workbookHistory.current.get(file.id)

  return {
    editor, file, recent, status, sourceView, registerSource, setSource, canEdit, trackView, info, metadata, warnings, activeHeading,
    activePane, activatePane, previewIssue, scrollAnchors,
    dirty, liveState, tabs, library: collection.library, layout: collection.layout,
    editorEpoch, historyError, loadVersions, createVersion, restoreHistoryVersion,
    captureSearch, subscribeSearch, presentSearch, applySearch, clearSearch,
    project, switchMode, createDocument, openDocument, renameDocument, duplicateDocument, deleteDocument, restoreDocument, closeTab, closeOtherTabs, reopenTab,
    importFile, save, captureExport, isCurrentExport, exportCopy, downloadOriginal, changeTitle, changeMetadata, jumpToHeading, replaceWorkbook, changeCsvDialect,
    moveWorkbookHistory, workbookCanUndo: !!currentWorkbookHistory?.undo.length, workbookCanRedo: !!currentWorkbookHistory?.redo.length,
  }
}
