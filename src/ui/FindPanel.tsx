import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { ChevronDown, ChevronUp, Replace, Search, WholeWord, X } from 'lucide-react'
import { searchTexts, locateSearchHits, type SearchDocument, type SearchHit, type SearchScope } from '../editor/documentSearch'
import type { SearchOptions } from '../core/search'
import type { EditorMode } from '../document/workspace'
import type { FolioHost } from '../host/contracts'
import { IconButton } from './controls'

export interface FindPanelHandle { focus(replace?: boolean): void; move(step: number): void }
interface Props {
  readOnly?: boolean
  panelRef: Ref<FindPanelHandle>
  documentId: string
  title: string
  mode: EditorMode
  startReplace: boolean
  find: FolioHost['search']
  capture(scope: SearchScope): SearchDocument | undefined
  subscribe(listener: () => void): () => void
  present(document: SearchDocument, hits: SearchHit[], active: number, scroll: boolean): void
  replace(document: SearchDocument, scope: SearchScope, hits: SearchHit[], value: string, regex: boolean): { replaced: number; skipped: number }
  clear(): void
  openSource(): void
  close(): void
}

export function FindPanel({ panelRef, documentId, title, mode, startReplace, find, capture, subscribe, present, replace, clear, openSource, close, readOnly }: Props) {
  const replaceId = useId()
  const [term, setTerm] = useState('')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<SearchScope>('rendered')
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false })
  const [expanded, setExpanded] = useState(startReplace)
  const [revision, setRevision] = useState(0)
  const [index, setIndex] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [actionError, setActionError] = useState('')
  const [results, setResults] = useState<{ key: object; hits: SearchHit[]; error?: string }>()
  const input = useRef<HTMLInputElement>(null)
  const presented = useRef<{ key: object; index: number } | undefined>(undefined)

  useEffect(() => subscribe(() => setRevision(previous => previous + 1)), [subscribe])
  useEffect(() => { input.current?.focus(); return clear }, [clear])
  useEffect(() => { setIndex(0); setActionError(''); setFeedback('') }, [documentId])

  const hasQuery = !!term
  const snapshot = useMemo(() => {
    if (!hasQuery) return
    try {
      const document = capture(scope)
      return { document: document?.id === documentId ? document : undefined, revision }
    } catch (reason) { return { error: reason instanceof Error ? reason.message : 'The document could not be read.' } }
  }, [capture, documentId, hasQuery, revision, scope])
  const model = snapshot?.document
  const capturedRevision = snapshot?.revision
  const request = useMemo(() => ({ model, scope, term, options }), [model, scope, term, options])
  const completed = results?.key === request ? results : undefined
  const hits = completed?.hits
  const active = hits?.length ? Math.min(index, hits.length - 1) : 0
  const error = actionError || snapshot?.error || completed?.error

  useEffect(() => {
    if (!request.model || !request.term) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const document = request.model!
      void find(searchTexts(document, request.scope), request.term, request.options, controller.signal).then(matches => {
        if (!controller.signal.aborted) setResults({ key: request, hits: locateSearchHits(document, request.scope, matches) })
      }, failure => {
        if (!controller.signal.aborted) setResults({ key: request, hits: [], error: failure instanceof Error ? failure.message : 'Search failed.' })
      })
    }, 65)
    return () => { clearTimeout(timer); controller.abort() }
  }, [find, request])

  useEffect(() => {
    if (!model || !hits?.length) {
      if (presented.current) { clear(); presented.current = undefined }
      return
    }
    const scroll = presented.current?.key !== request || presented.current?.index !== active
    presented.current = { key: request, index: active }
    present(model, hits, active, scroll)
  }, [active, capturedRevision, clear, hits, mode, model, present, request])

  function move(step: number) {
    if (!hits?.length) return
    const next = (active + step + hits.length) % hits.length
    if (next === active && model) present(model, hits, active, true)
    else setIndex(next)
  }

  useImperativeHandle(panelRef, () => ({
    move,
    focus(replaceVisible) {
      if (replaceVisible) setExpanded(true)
      const target = input.current
      if (!target) return
      const focusInput = () => { target.focus(); target.select() }
      focusInput()
      // A command can run just before the modal palette releases focus.
      if (target.ownerDocument.activeElement !== target) requestAnimationFrame(() => { if (target.isConnected) focusInput() })
    },
  }))

  function resetResult() { setIndex(0); setActionError(''); setFeedback('') }
  function performReplace(all: boolean) {
    if (!model || !hits?.length) return
    setActionError('')
    setFeedback('')
    try {
      const { replaced, skipped } = replace(model, scope, all ? hits : [hits[active]], value, options.regex)
      const parts = [replaced ? `${replaced} ${replaced === 1 ? 'match replaced' : 'matches replaced'}.` : '',
        skipped ? `${skipped} ${skipped === 1 ? 'match spans' : 'matches span'} multiple formats. Use Raw Markdown to edit ${skipped === 1 ? 'it' : 'them'}.` : '']
      setFeedback(parts.filter(Boolean).join(' ') || 'The replacement matches the current text.')
      if (all) setIndex(0)
      else if (!replaced && !skipped) move(1)
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Could not replace the match.') }
  }

  const selected = hits?.[active]
  const sourceOnly = scope === 'source' && mode === 'visual' && selected && !selected.visual.length
  const unmapped = scope === 'rendered' && mode === 'source' && selected && !selected.source.length

  return <section className="find-panel" aria-label="Find and replace" onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <div className="find-row">
      <IconButton label={expanded ? 'Hide replacement' : 'Show replacement'} expanded={expanded} controls={replaceId} onClick={() => setExpanded(previous => !previous)}><Replace size={15} /></IconButton>
      <label className="find-input"><Search size={15} /><input ref={input} aria-label="Find text" placeholder={'Find in ' + title} value={term} onChange={event => { resetResult(); setTerm(event.target.value) }} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); move(event.shiftKey ? -1 : 1) }
      }} /></label>
      <select aria-label="Search scope" value={scope} onChange={event => { resetResult(); setScope(event.target.value as SearchScope) }}>
        <option value="rendered">Rendered content</option><option value="source">Raw Markdown</option>
      </select>
      <div className="find-options" role="group" aria-label="Search options">
        {([['caseSensitive', 'Match case', 'Aa'], ['wholeWord', 'Whole word', <WholeWord size={15} />], ['regex', 'Regular expression', '.*']] as const).map(([key, label, symbol]) => (
          <IconButton key={key} label={label} active={options[key]}
            onClick={() => { resetResult(); setOptions(previous => ({ ...previous, [key]: !previous[key] })) }}><span aria-hidden="true">{symbol}</span></IconButton>
        ))}
      </div>
      <span className="find-count" role="status">{error ? 'Search unavailable' : !hasQuery ? 'Enter text' : !completed ? 'Searching…' : hits?.length ? `${active + 1} of ${hits.length} ${hits.length === 1 ? 'match' : 'matches'}` : 'No matches'}</span>
      <div className="find-navigation">
        <IconButton label="Previous match" disabled={!hits?.length} onClick={() => move(-1)}><ChevronUp size={17} /></IconButton>
        <IconButton label="Next match" disabled={!hits?.length} onClick={() => move(1)}><ChevronDown size={17} /></IconButton>
        <IconButton label="Close find" onClick={close}><X size={17} /></IconButton>
      </div>
    </div>
    <form id={replaceId} className="find-replace-row" hidden={!expanded} onSubmit={event => { event.preventDefault(); performReplace(false) }}>
      <input className="find-input" aria-label="Replace with" placeholder="Replace with" value={value} onChange={event => { setValue(event.target.value); setActionError('') }} />
      <button type="submit" className="secondary-button" disabled={readOnly || !hits?.length || !model?.canReplace}>Replace</button>
      <button type="button" className="secondary-button" disabled={readOnly || !hits?.length || !model?.canReplace} onClick={() => performReplace(true)}>Replace all</button>
    </form>
    {sourceOnly && <div className="find-feedback">This match is visible in Markdown Source. <button type="button" onClick={openSource}>Show source</button></div>}
    {unmapped && <div className="find-feedback">This match is shown near its Markdown block. An exact source span is unavailable.</div>}
    {model && !model.canReplace && <p className="find-feedback">Finish the Markdown structure or use Raw Markdown to replace text in this draft.</p>}
    {error && <p className="find-feedback field-error" role="alert">{error}</p>}
    {feedback && <p className="find-feedback" role="status">{feedback}</p>}
  </section>
}
