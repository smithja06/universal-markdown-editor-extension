import { CircleAlert } from 'lucide-react'
import { argumentHint, type FormulaAssistState } from './formulaAssist'

/** Function suggestions and the active argument for the formula being edited. All data comes from the local catalog. */
export function FormulaAssistPanel({ id, state, index, open, pick }: {
  id: string; state: FormulaAssistState; index: number; open: boolean; pick(index: number): void
}) {
  const hint = state.call && argumentHint(state.call.entry, state.call.argument)
  const selected = open ? state.suggestions[index] : undefined
  if (!open && !hint && !state.unsupported.length) return null
  return <div className="folio-sheet-assist" role="group" aria-label="Formula help">
    {open && <ul id={id} role="listbox" aria-label="Function suggestions" className="folio-sheet-assist-list">
      {state.suggestions.map((entry, position) => <li key={entry.name} id={`${id}-${entry.name}`} role="option" aria-selected={position === index}
        className={position === index ? 'is-active' : undefined}
        // Keep focus in the formula field so the edit continues after choosing a function.
        onMouseDown={event => { event.preventDefault(); pick(position) }}>
        <strong>{entry.name}</strong><span>{entry.category}</span>
      </li>)}
    </ul>}
    <div className="folio-sheet-assist-detail" aria-live="polite">
      {selected ? <><code>{selected.syntax}</code><p>{selected.description}</p><small>Tab or Enter inserts · Esc closes</small></>
        : hint && state.call ? <><code aria-label={`${state.call.entry.name} arguments`}>{state.call.entry.name}(
          {hint.args.map((arg, position) => <span key={position}>{position ? ', ' : ''}
            {position === hint.active ? <mark>{arg}</mark> : arg}</span>)})</code><p>{state.call.entry.description}</p></> : null}
      {state.unsupported.length > 0 && <p className="folio-sheet-assist-warning" role="status"><CircleAlert size={14} />
        {state.unsupported.slice(0, 3).join(', ')} {state.unsupported.length === 1 ? 'is' : 'are'} not in Folio’s supported formula list.
        Folio keeps the formula text and shows #UNSUPPORTED! instead of calculating it.</p>}
    </div>
  </div>
}
