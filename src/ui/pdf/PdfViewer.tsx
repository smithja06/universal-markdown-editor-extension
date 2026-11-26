import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Copy, LoaderCircle, Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import { browserPdfRuntime, openPdf, type PdfHandle, type PdfLib, type PdfRuntime } from '../../document/formats/pdf/engine'
import { pdfLimits, pdfNotices, PdfInputError, type PdfSummary } from '../../document/formats/pdf/model'
import { findInPage, hasText, normalizedQuery, type PdfMatch } from '../../document/formats/pdf/text'
import { IconButton } from '../controls'
import { PdfPages } from './pdfPages'
import './pdf.css'

export type PdfZoom = { mode: 'fit-width' | 'fit-page' } | { mode: 'custom'; scale: number }
const zoomSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const padding = 32

export interface PdfViewerHandle { find(): void }

interface Props {
  /** Exact bytes to display. The viewer never modifies them. */
  bytes: Uint8Array | undefined
  /** Changing the key reloads the document. */
  documentKey: string
  label: string
  notify(message: string): void
  copyText?(text: string): Promise<void>
  actions?: ReactNode
  /** A smaller viewer without search, used for export previews. */
  preview?: boolean
  findRequest?: number
  onSummary?(summary: PdfSummary | undefined): void
  onError?(message: string): void
  runtime?: () => Promise<PdfRuntime>
}

interface SearchState { query: string; matches: PdfMatch[]; active: number; scanned: number; textless: number; running: boolean; truncated: boolean; error?: string }
const emptySearch: SearchState = { query: '', matches: [], active: -1, scanned: 0, textless: 0, running: false, truncated: false }

function zoomLabel(zoom: PdfZoom, scale: number) {
  const percent = Math.round(scale * 100) + '%'
  return zoom.mode === 'fit-width' ? `Fit width (${percent})` : zoom.mode === 'fit-page' ? `Fit page (${percent})` : percent
}

function selectionText() {
  return (globalThis.getSelection?.()?.toString() ?? '').normalize('NFC').replaceAll(String.fromCharCode(160), ' ')
}

export function PdfViewer({ bytes, documentKey, label, notify, copyText, actions, preview = false, findRequest, onSummary, onError, runtime = browserPdfRuntime }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const pages = useRef<PdfPages | null>(null)
  const handleRef = useRef<PdfHandle | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<PdfSummary>()
  const [page, setPage] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const [zoom, setZoom] = useState<PdfZoom>({ mode: 'fit-width' })
  const [scale, setScale] = useState(1)
  const [findOpen, setFindOpen] = useState(false)
  const [search, setSearch] = useState<SearchState>(emptySearch)
  const searchRun = useRef<AbortController>(undefined)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const reportError = useRef(onError)
  reportError.current = onError
  const reportSummary = useRef(onSummary)
  reportSummary.current = onSummary

  const fitScale = useCallback((next: PdfZoom) => {
    const view = pages.current
    const element = scroller.current
    if (!view || !element) return 1
    if (next.mode === 'custom') return next.scale
    const size = view.pageSize(view.currentPage()) ?? { width: 612, height: 792 }
    const width = Math.max(120, element.clientWidth - padding) / size.width
    if (next.mode === 'fit-width') return Math.min(pdfLimits.maxZoom, Math.max(pdfLimits.minZoom, width))
    const height = Math.max(120, element.clientHeight - padding) / size.height
    return Math.min(pdfLimits.maxZoom, Math.max(pdfLimits.minZoom, Math.min(width, height)))
  }, [])

  const applyZoom = useCallback((next: PdfZoom) => {
    const value = fitScale(next)
    setZoom(next)
    setScale(value)
    pages.current?.setScale(value)
  }, [fitScale])

  useEffect(() => {
    if (!bytes) return
    const controller = new AbortController()
    let opened: PdfHandle | undefined
    let view: PdfPages | undefined
    setStatus('loading')
    setError('')
    setSummary(undefined)
    setSearch(emptySearch)
    setPage(0)
    setPageInput('1')
    void (async () => {
      try {
        const loaded = await runtime()
        controller.signal.throwIfAborted()
        opened = await openPdf(bytes, loaded, controller.signal)
        if (controller.signal.aborted) { await opened.destroy(); return }
        handleRef.current = opened
        if (!scroller.current || !content.current) return
        content.current.replaceChildren()
        view = new PdfPages(scroller.current, content.current, opened, loaded.lib as PdfLib, {
          page: index => { setPage(index); setPageInput(String(index + 1)) },
          rendered: () => undefined,
          error: message => notify(message),
        }, !preview)
        pages.current = view
        await view.initialize()
        if (controller.signal.aborted) return
        const value = fitScale(zoomRef.current)
        setScale(value)
        view.setScale(value)
        const next = { pageCount: opened.pageCount, title: opened.title, features: opened.features }
        setSummary(next)
        reportSummary.current?.(next)
        setStatus('ready')
      } catch (failure) {
        if (controller.signal.aborted) return
        const message = failure instanceof PdfInputError ? failure.message : 'Folio could not display this PDF.'
        setError(message)
        setStatus('error')
        reportSummary.current?.(undefined)
        reportError.current?.(message)
      }
    })()
    return () => {
      controller.abort()
      searchRun.current?.abort()
      pages.current = null
      handleRef.current = null
      void view?.dispose()
      void opened?.destroy()
    }
  }, [bytes, documentKey, fitScale, notify, preview, runtime])

  useEffect(() => {
    const element = scroller.current
    if (!element || status !== 'ready') return
    const observer = new ResizeObserver(() => {
      if (zoomRef.current.mode !== 'custom') applyZoom(zoomRef.current)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [applyZoom, status])

  const [focusFind, setFocusFind] = useState(0)
  const openFind = useCallback(() => {
    if (preview) return
    setFindOpen(true)
    setFocusFind(value => value + 1)
  }, [preview])
  useEffect(() => {
    if (!focusFind) return
    findInput.current?.focus()
    findInput.current?.select()
  }, [focusFind])

  useEffect(() => { if (findRequest) openFind() }, [findRequest, openFind])

  const runSearch = useCallback((query: string) => {
    searchRun.current?.abort()
    const handle = handleRef.current
    const view = pages.current
    if (!handle || !view || !normalizedQuery(query)) {
      setSearch({ ...emptySearch, query })
      view?.setMatches([], -1)
      return
    }
    const controller = new AbortController()
    searchRun.current = controller
    const start = view.currentPage()
    setSearch({ ...emptySearch, query, running: true })
    void (async () => {
      const matches: PdfMatch[] = []
      let textless = 0
      let truncated = false
      let active = -1
      try {
        for (let index = 0; index < handle.pageCount; index++) {
          const text = await handle.text(index, controller.signal)
          if (controller.signal.aborted) return
          view.rememberText(text)
          if (!hasText(text)) textless++
          truncated ||= text.truncated
          const found = findInPage(text, query, 10_000 - matches.length)
          if (active < 0 && found.length && index >= start) active = matches.length
          matches.push(...found)
          if (index % 10 === 9 || index === handle.pageCount - 1) {
            const current = active < 0 && matches.length ? 0 : active
            setSearch({ query, matches: [...matches], active: current, scanned: index + 1, textless, running: index < handle.pageCount - 1, truncated })
            view.setMatches(matches, current)
            await new Promise(resolve => setTimeout(resolve))
          }
          if (matches.length >= 10_000) { truncated = true; break }
        }
        const current = active < 0 && matches.length ? 0 : active
        setSearch({ query, matches, active: current, scanned: handle.pageCount, textless, running: false, truncated })
        view.setMatches(matches, current)
        if (current >= 0) view.revealMatch(matches[current])
      } catch (failure) {
        if (controller.signal.aborted) return
        setSearch(previous => ({ ...previous, running: false, error: failure instanceof Error ? failure.message : 'Search failed.' }))
      }
    })()
  }, [])

  useEffect(() => {
    if (!findOpen) return
    const timer = setTimeout(() => runSearch(search.query), 180)
    return () => clearTimeout(timer)
    // Search reruns when the query changes, not on progress updates.
  }, [search.query, findOpen, runSearch, status])

  function moveMatch(step: number) {
    setSearch(previous => {
      if (!previous.matches.length) return previous
      const active = (previous.active + step + previous.matches.length) % previous.matches.length
      pages.current?.setMatches(previous.matches, active)
      pages.current?.revealMatch(previous.matches[active])
      return { ...previous, active }
    })
  }

  function closeFind() {
    searchRun.current?.abort()
    setFindOpen(false)
    setSearch(emptySearch)
    pages.current?.setMatches([], -1)
    scroller.current?.focus()
  }

  function goTo(index: number) {
    const count = summary?.pageCount ?? 0
    if (!count) return
    const target = Math.min(Math.max(index, 0), count - 1)
    pages.current?.scrollToPage(target)
    setPage(target)
    setPageInput(String(target + 1))
  }

  function stepZoom(direction: 1 | -1) {
    const current = scale
    const next = direction > 0 ? zoomSteps.find(step => step > current + 0.001) ?? pdfLimits.maxZoom
      : [...zoomSteps].reverse().find(step => step < current - 0.001) ?? pdfLimits.minZoom
    applyZoom({ mode: 'custom', scale: next })
  }

  async function copy(text: string) {
    if (!text) { notify('Select text on a page to copy it.'); return }
    try {
      if (copyText) await copyText(text)
      else await navigator.clipboard.writeText(text)
      notify('Copied PDF text')
    } catch { notify('Could not copy to the clipboard.') }
  }

  async function copyPage() {
    const handle = handleRef.current
    if (!handle) return
    try {
      const text = await handle.text(pages.current?.currentPage() ?? page)
      if (!hasText(text)) { notify('This page has no embedded text to copy.'); return }
      await copy(text.text.trim())
    } catch { notify('Could not read text on this page.') }
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (status !== 'ready' || event.altKey) return
    const primary = event.ctrlKey || event.metaKey
    const target = event.target as HTMLElement
    const typing = target.closest('input, select, textarea')
    if (primary && event.key.toLowerCase() === 'f' && !preview) { event.preventDefault(); event.stopPropagation(); openFind(); return }
    if (primary && (event.key === '=' || event.key === '+')) { event.preventDefault(); stepZoom(1); return }
    if (primary && event.key === '-') { event.preventDefault(); stepZoom(-1); return }
    if (primary && event.key === '0') { event.preventDefault(); applyZoom({ mode: 'fit-width' }); return }
    if (typing) return
    if (event.key === 'PageDown' || (event.key === 'ArrowRight' && !primary)) { event.preventDefault(); goTo(page + 1) }
    else if (event.key === 'PageUp' || (event.key === 'ArrowLeft' && !primary)) { event.preventDefault(); goTo(page - 1) }
    else if (event.key === 'Home' && !primary) { event.preventDefault(); goTo(0) }
    else if (event.key === 'End' && !primary) { event.preventDefault(); goTo((summary?.pageCount ?? 1) - 1) }
    else if (event.key === 'F3' && findOpen) { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1) }
  }

  const count = summary?.pageCount ?? 0
  const notices = summary ? pdfNotices(summary.features) : []
  const allTextless = !search.running && search.scanned === count && count > 0 && search.textless === count
  const searchStatus = search.error ? search.error
    : allTextless ? 'This PDF has no embedded text. Search cannot find words shown only in page images.'
      : !normalizedQuery(search.query) ? ''
        : search.running && !search.matches.length ? `Searching page ${search.scanned + 1} of ${count}…`
          : search.matches.length ? `${search.active + 1} of ${search.matches.length.toLocaleString()}${search.truncated ? '+' : ''}`
            : 'No matches in the embedded text'
  const textlessNote = !allTextless && search.textless > 0 && normalizedQuery(search.query) && !search.running
    ? `${search.textless} ${search.textless === 1 ? 'page has' : 'pages have'} no embedded text and ${search.textless === 1 ? 'was' : 'were'} not searched.` : ''

  return <section className={'pdf-viewer' + (preview ? ' pdf-preview' : '')} aria-label={label} onKeyDown={keyDown}
    onCopy={event => {
      const text = selectionText()
      if (!text || !scroller.current?.contains(globalThis.getSelection?.()?.anchorNode ?? null)) return
      event.clipboardData.setData('text/plain', text)
      event.preventDefault()
      if (copyText) void copyText(text).catch(() => undefined)
    }}>
    <div className="pdf-toolbar" role="toolbar" aria-label="PDF navigation">
      <div className="toolbar-group">
        <IconButton label="Previous page" disabled={status !== 'ready' || page <= 0} onClick={() => goTo(page - 1)}><ChevronUp size={17} /></IconButton>
        <IconButton label="Next page" disabled={status !== 'ready' || page >= count - 1} onClick={() => goTo(page + 1)}><ChevronDown size={17} /></IconButton>
        <form className="pdf-page-form" onSubmit={event => { event.preventDefault(); const value = Number.parseInt(pageInput, 10); if (Number.isFinite(value)) goTo(value - 1) }}>
          <input aria-label="Page number" inputMode="numeric" value={pageInput} disabled={status !== 'ready'}
            onChange={event => setPageInput(event.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={() => setPageInput(String(page + 1))} />
          <span className="pdf-page-count">of {count || '–'}</span>
        </form>
      </div>
      <div className="toolbar-group">
        <IconButton label="Zoom out" disabled={status !== 'ready' || scale <= pdfLimits.minZoom + 0.001} onClick={() => stepZoom(-1)}><ZoomOut size={17} /></IconButton>
        <select aria-label="Zoom" className="pdf-zoom" disabled={status !== 'ready'} value={zoom.mode === 'custom' ? String(zoom.scale) : zoom.mode}
          onChange={event => {
            const value = event.target.value
            applyZoom(value === 'fit-width' || value === 'fit-page' ? { mode: value } : { mode: 'custom', scale: Number(value) })
          }}>
          <option value="fit-width">{zoom.mode === 'fit-width' ? zoomLabel(zoom, scale) : 'Fit width'}</option>
          <option value="fit-page">{zoom.mode === 'fit-page' ? zoomLabel(zoom, scale) : 'Fit page'}</option>
          {zoom.mode === 'custom' && !zoomSteps.includes(zoom.scale) && <option value={String(zoom.scale)}>{zoomLabel(zoom, scale)}</option>}
          {zoomSteps.map(step => <option key={step} value={String(step)}>{Math.round(step * 100)}%</option>)}
        </select>
        <IconButton label="Zoom in" disabled={status !== 'ready' || scale >= pdfLimits.maxZoom - 0.001} onClick={() => stepZoom(1)}><ZoomIn size={17} /></IconButton>
      </div>
      {!preview && <div className="toolbar-group">
        <IconButton label="Find in PDF" active={findOpen} disabled={status !== 'ready'} onClick={() => findOpen ? closeFind() : openFind()}><Search size={16} /></IconButton>
        <IconButton label="Copy page text" disabled={status !== 'ready'} onClick={() => void copyPage()}><Copy size={16} /></IconButton>
      </div>}
      {actions && <div className="toolbar-group pdf-actions">{actions}</div>}
      <span className="pdf-readonly" title="Folio displays PDFs read-only">Read-only</span>
    </div>
    {findOpen && <div className="pdf-find" role="search">
      <Search size={15} aria-hidden="true" />
      <input ref={findInput} aria-label="Find in PDF" placeholder="Find in embedded text" value={search.query}
        onChange={event => setSearch(previous => ({ ...previous, query: event.target.value }))}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1) }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind() }
        }} />
      <span className="pdf-find-status" role="status" aria-live="polite">{searchStatus}</span>
      <IconButton label="Previous match" disabled={!search.matches.length} onClick={() => moveMatch(-1)}><ChevronLeft size={16} /></IconButton>
      <IconButton label="Next match" disabled={!search.matches.length} onClick={() => moveMatch(1)}><ChevronRight size={16} /></IconButton>
      <IconButton label="Close find" onClick={closeFind}><X size={16} /></IconButton>
      {textlessNote && <span className="pdf-find-note">{textlessNote}</span>}
    </div>}
    {!preview && notices.length > 0 && <div className="pdf-notices" role="note">{notices.map(notice => <span key={notice}><CircleAlert size={13} aria-hidden="true" />{notice}</span>)}</div>}
    <div ref={scroller} className="pdf-scroll" tabIndex={0} aria-label={`${label} pages`} data-status={status}
      onScroll={() => { const view = pages.current; if (view) { const next = view.currentPage(); if (next !== page) { setPage(next); setPageInput(String(next + 1)) } } }}>
      {status === 'loading' && <div className="opening-state pdf-state" role="status"><LoaderCircle size={20} className="spinner" /> Opening PDF…</div>}
      {status === 'error' && <div className="pdf-state pdf-error" role="alert"><CircleAlert size={20} /><div><strong>This PDF cannot be displayed.</strong><p>{error}</p></div></div>}
      <div ref={content} className="pdf-pages" hidden={status === 'error'} />
    </div>
  </section>
}

export { selectionText as pdfSelectionText }
