import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, FilePlus2, FileText, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { DocumentSummary } from '../document/workspace'
import { IconButton, Modal } from './controls'

type View = 'All documents' | 'Recent' | 'Trash'
type Sort = 'modified' | 'created' | 'ascending' | 'descending'
const views: View[] = ['All documents', 'Recent', 'Trash']
const calendar = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

interface Props {
  items: DocumentSummary[]
  tabs: string[]
  close(): void
  create(): void
  open(id: string): Promise<void>
  rename(id: string, title: string): Promise<void>
  duplicate(id: string): Promise<void>
  remove(id: string): Promise<void>
  restore(id: string): Promise<void>
}

export function DocumentLibrary({ items, tabs, close, create, open, rename, duplicate, remove, restore }: Props) {
  const [view, setView] = useState<View>('All documents')
  const [sort, setSort] = useState<Sort>('modified')
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<{ kind: 'rename' | 'remove'; item: DocumentSummary }>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const confirmationTrigger = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const openIds = new Set(tabs)

  useLayoutEffect(() => {
    if (pending || busy || !confirmationTrigger.current) return
    const trigger = confirmationTrigger.current
    confirmationTrigger.current = null
    ;(trigger.isConnected ? trigger : searchInput.current)?.focus({ preventScroll: true })
  }, [busy, pending])

  const shown = useMemo(() => {
    const query = search.trim().normalize('NFKC').toLocaleLowerCase()
    const matching = items.filter(item => (view === 'Trash') === (item.deletedAt !== undefined) && (view !== 'Recent' || item.openedAt !== undefined) && item.title.normalize('NFKC').toLocaleLowerCase().includes(query))
    return matching.sort((left, right) => {
      if (sort === 'ascending') return names.compare(left.title, right.title)
      if (sort === 'descending') return names.compare(right.title, left.title)
      if (sort === 'created') return right.createdAt - left.createdAt
      if (view === 'Recent') return (right.openedAt ?? 0) - (left.openedAt ?? 0)
      if (view === 'Trash') return (right.deletedAt ?? 0) - (left.deletedAt ?? 0)
      return right.updated - left.updated
    })
  }, [items, search, sort, view])

  async function run(operation: () => void | Promise<void>, after: 'close' | string = '') {
    if (busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await operation()
      setPending(undefined)
      if (after === 'close') close()
      else setFeedback(after)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }

  return <Modal title="Document library" wide closeDisabled={busy} close={() => { if (!busy) close() }}>
    <div className="document-library">
      <div className="library-navigation">
        <div className="library-views" role="group" aria-label="Document collections">{views.map(option => <button key={option} type="button" aria-pressed={option === view} disabled={busy} onClick={() => { confirmationTrigger.current = null; setPending(undefined); setView(option); setError(''); setFeedback('') }}>{option}</button>)}</div>
        <button type="button" className="primary-button library-new" disabled={busy} onClick={() => void run(create, 'close')}><FilePlus2 size={15} /> New document</button>
      </div>
      <div className="library-controls">
        <label className="library-search"><Search size={16} /><input ref={searchInput} data-dialog-focus type="search" aria-label="Search documents" placeholder="Search by name" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <select aria-label="Sort documents" value={sort} onChange={event => setSort(event.target.value as Sort)}>
          <option value="modified">{view === 'Recent' ? 'Recently opened' : view === 'Trash' ? 'Recently deleted' : 'Recently modified'}</option><option value="created">Recently created</option><option value="ascending">Name A–Z</option><option value="descending">Name Z–A</option>
        </select>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {feedback && <p className="muted" role="status">{feedback}</p>}
      {pending && <form className="library-confirm" onSubmit={event => {
        event.preventDefault()
        if (pending.kind === 'rename') void run(() => rename(pending.item.id, name), 'Document renamed.')
        else void run(() => remove(pending.item.id), 'Document moved to Trash.')
      }}>
        {pending.kind === 'rename' ? <label className="field">Document name<input autoFocus required maxLength={155} value={name} onChange={event => setName(event.target.value)} /></label>
          : <p>Move <strong>{pending.item.title}</strong> to Trash? {openIds.has(pending.item.id) && 'Its open tab will close. '}You can recover the draft and its version history from Trash.</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" autoFocus={pending.kind === 'remove'} disabled={busy} onClick={() => { setPending(undefined); setError('') }}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy || (pending.kind === 'rename' && !name.trim())}>{pending.kind === 'rename' ? 'Save name' : 'Move to Trash'}</button>
        </div>
      </form>}
      <div className="library-results" role="region" aria-label={view} tabIndex={0}>
        {shown.length === 0 ? <div className="library-empty"><FileText size={24} /><p>{search.trim() ? 'No documents match your search.' : view === 'Trash' ? 'Trash is empty.' : view === 'Recent' ? 'Recently opened documents will appear here.' : 'Create a document to start your library.'}</p></div>
          : <ul>{shown.map(item => <li className="library-row" key={item.id}>
            <FileText size={17} aria-hidden="true" className="library-row-icon" />
            <div className="library-row-details">
              {view === 'Trash' ? <strong>{item.title}</strong> : <button type="button" className="library-open" disabled={busy} onClick={() => void run(() => open(item.id), 'close')}>{item.title}</button>}
              <p className="muted">{item.format === 'pdf' ? 'PDF' : item.format === 'docx' ? 'DOCX' : item.format === 'txt' ? 'TXT' : 'Markdown'} · {view === 'Trash' ? `Deleted ${calendar.format(item.deletedAt)}` : `Modified ${calendar.format(item.updated)} · Created ${calendar.format(item.createdAt)}`}{item.words !== undefined && ` · ${item.words.toLocaleString()} ${item.words === 1 ? 'word' : 'words'}`}{openIds.has(item.id) && ' · Open'}</p>
            </div>
            <div className="library-row-actions">
              {view === 'Trash' ? <button type="button" className="secondary-button" disabled={busy} aria-label={'Restore ' + item.title} onClick={() => void run(() => restore(item.id), 'Document restored to the library.')}><RotateCcw size={13} /> Restore</button> : <>
                <IconButton label={'Rename ' + item.title} disabled={busy} onClick={event => { confirmationTrigger.current = event.currentTarget; setName(item.title); setPending({ kind: 'rename', item }) }}><Pencil size={15} /></IconButton>
                <IconButton label={'Duplicate ' + item.title} disabled={busy} onClick={() => void run(() => duplicate(item.id), 'close')}><Copy size={15} /></IconButton>
                <IconButton label={'Delete ' + item.title} disabled={busy} onClick={event => { confirmationTrigger.current = event.currentTarget; setPending({ kind: 'remove', item }) }}><Trash2 size={15} /></IconButton>
              </>}
            </div>
          </li>)}</ul>}
      </div>
    </div>
  </Modal>
}
