import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { fuzzyScore } from '../core/commands'
import { Modal } from './controls'

export interface PaletteEntry { key: string; id: string; label: string; category: string; keywords?: string; argument?: string; shortcut?: string; hint?: string }

export function CommandPalette({ entries, recent, scope, run, close }: {
  entries: PaletteEntry[]; recent: string[]; scope: 'all' | 'documents' | 'headings'; run(entry: PaletteEntry): void; close(): void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = useMemo(() => {
    const matched = entries.map((entry, order) => ({ entry, order, recent: recent.indexOf(entry.key), score: fuzzyScore(query, entry.label, entry.keywords) })).filter(entry => entry.score >= 0)
    const rank = (position: number) => position < 0 ? Infinity : position
    matched.sort((left, right) => right.score - left.score || rank(left.recent) - rank(right.recent) || left.order - right.order)
    return matched.slice(0, 80).map(({ entry, recent }) => ({ ...entry, group: !query.trim() && recent >= 0 ? 'Recently used' : entry.category }))
  }, [entries, query, recent])
  const current = Math.min(index, Math.max(0, results.length - 1))

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [current, query])
  const placeholder = scope === 'documents' ? 'Find an open or saved document' : scope === 'headings' ? 'Find a heading' : 'Search commands and documents'

  return <Modal title={scope === 'documents' ? 'Switch document' : scope === 'headings' ? 'Go to heading' : 'Command Palette'} close={close} wide>
    <div className="command-palette">
      <label className="palette-search"><Search size={17} /><input ref={input} autoFocus role="combobox" aria-label={placeholder} placeholder={placeholder}
        aria-expanded="true" aria-controls={id} aria-activedescendant={results.length ? `${id}-${current}` : undefined} aria-autocomplete="list" spellCheck={false}
        value={query} onChange={event => { setQuery(event.target.value); setIndex(0) }} onKeyDown={event => {
          if (!results.length) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex((current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length) }
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); run(results[current]) }
        }} /></label>
      <div ref={list} id={id} className="palette-results" role="listbox" aria-label="Matching commands">
        {results.map((entry, position) => <div key={entry.key} role="presentation">
          {entry.group !== results[position - 1]?.group && <div className="palette-category" aria-hidden="true">{entry.group}</div>}
          <div id={`${id}-${position}`} role="option" aria-selected={position === current} className="palette-option" onMouseDown={event => event.preventDefault()} onClick={() => run(entry)}>
            <span><strong>{entry.label}</strong>{entry.hint && <small>{entry.hint}</small>}</span>
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </div>
        </div>)}
      </div>
      {!results.length && <p className="muted" role="status">No matches.</p>}
    </div>
  </Modal>
}
