import { useEffect, useRef } from 'react'
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo } from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { syntaxTree } from '@codemirror/language'
import { sourceSearchDecorations } from './searchDecorations'

export interface SourceLocation { line: number; column: number }

const selectionKeymap = searchKeymap.filter(binding => ['Mod-Alt-g', 'Mod-d', 'Mod-Shift-l'].includes(binding.key ?? ''))

interface Props {
  initial: string
  active: boolean
  lineNumberDisplay: boolean
  wordWrap: boolean
  readOnly?: boolean
  onChange(value: string): void
  canEdit(): boolean
  onLocation(location: SourceLocation): void
  onReady(runtime: SourceRuntime | null): void
  onLanguageError(): void
  onOpenLink?(reference: string, event: MouseEvent): boolean
}

export interface SourceRuntime { view: EditorView; apply(value: string | EditorState): void }

export function replaceSource(view: EditorView | null, source: string, origin: 'visual' | 'metadata' | 'search' | 'host', recordHistory = true) {
  if (!view) return
  const previous = view.state.doc.toString()
  if (previous === source) return
  let start = 0
  while (start < previous.length && start < source.length && previous[start] === source[start]) start++
  let beforeEnd = previous.length
  let afterEnd = source.length
  while (beforeEnd > start && afterEnd > start && previous[beforeEnd - 1] === source[afterEnd - 1]) {
    beforeEnd--
    afterEnd--
  }
  view.dispatch({
    filter: origin !== 'host',
    changes: { from: start, to: beforeEnd, insert: source.slice(start, afterEnd) },
    annotations: [
      ...(recordHistory ? [isolateHistory.of('full')] : [Transaction.addToHistory.of(false)]),
      Transaction.userEvent.of('folio.' + origin),
    ],
  })
}

export function SourceEditor(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const settings = useRef(new Compartment())
  const language = useRef(new Compartment())
  const languageSupport = useRef<Extension>(undefined)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    if (!container.current) return
    const configuration = () => [
      ...(latest.current.lineNumberDisplay ? [lineNumbers(), highlightActiveLineGutter()] : []),
      ...(latest.current.wordWrap ? [EditorView.lineWrapping] : []),
      EditorState.readOnly.of(!!latest.current.readOnly), EditorView.editable.of(!latest.current.readOnly),
    ]
    const reportLocation = (state: EditorState) => {
      const head = state.selection.main.head
      const line = state.doc.lineAt(head)
      latest.current.onLocation({ line: line.number, column: head - line.from + 1 })
    }
    const createState = (doc: string) => EditorState.create({
        doc,
        extensions: [
          EditorState.transactionFilter.of(transaction => !transaction.docChanged || latest.current.canEdit() ? transaction : []),
          settings.current.of(configuration()), history(), highlightActiveLine(), highlightSelectionMatches(), sourceSearchDecorations,
          language.current.of(languageSupport.current ?? []),
          keymap.of([{ key: 'Mod-Shift-z', run: redo, preventDefault: true }, ...defaultKeymap, ...historyKeymap, ...selectionKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown source editor', 'aria-multiline': 'true', tabindex: '0' }),
          EditorView.domEventHandlers({
            click(event, view) {
              if (!latest.current.onOpenLink || event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return false
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
              if (position === null) return false
              let node = syntaxTree(view.state).resolveInner(position, 1)
              while (node.parent && node.name !== 'Link') node = node.parent
              const url = node.name === 'Link' ? node.getChild('URL') : null
              return !!url && latest.current.onOpenLink(view.state.sliceDoc(url.from, url.to).replace(/^<(.*)>$/, '$1'), event)
            },
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && update.transactions.some(transaction => transaction.docChanged && !transaction.isUserEvent('folio.visual') && !transaction.isUserEvent('folio.host'))) {
              latest.current.onChange(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged) reportLocation(update.state)
          }),
        ],
    })
    const editor = new EditorView({ parent: container.current, state: createState(latest.current.initial) })
    view.current = editor
    latest.current.onReady({ view: editor, apply(value) {
      editor.setState(typeof value === 'string' ? createState(value) : value)
      if (typeof value !== 'string') editor.dispatch({ effects: [settings.current.reconfigure(configuration()), language.current.reconfigure(languageSupport.current ?? [])] })
      reportLocation(editor.state)
    } })
    return () => { latest.current.onReady(null); view.current = null; editor.destroy() }
  }, [])

  useEffect(() => {
    if (!props.active || languageSupport.current) return
    let current = true
    void import('./SourceLanguage').then(({ sourceLanguage }) => {
      if (!current) return
      languageSupport.current = sourceLanguage
      view.current?.dispatch({ effects: language.current.reconfigure(sourceLanguage) })
    }, () => { if (current) latest.current.onLanguageError() })
    return () => { current = false }
  }, [props.active])

  useEffect(() => {
    view.current?.dispatch({ effects: settings.current.reconfigure([
      ...(props.lineNumberDisplay ? [lineNumbers(), highlightActiveLineGutter()] : []),
      ...(props.wordWrap ? [EditorView.lineWrapping] : []),
      EditorState.readOnly.of(!!props.readOnly), EditorView.editable.of(!props.readOnly),
    ]) })
  }, [props.lineNumberDisplay, props.wordWrap, props.readOnly])

  return <div ref={container} className="source-editor" />
}
