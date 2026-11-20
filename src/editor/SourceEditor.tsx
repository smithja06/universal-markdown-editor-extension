import { useEffect, useRef } from 'react'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { linter, lintGutter, lintKeymap } from '@codemirror/lint'
import { validateSource } from './sourceDiagnostics'

export interface SourceLocation { line: number; column: number }

const syntax = HighlightStyle.define([
  { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3], class: 'md-heading' },
  { tag: [tags.strong], class: 'md-strong' },
  { tag: [tags.emphasis], class: 'md-emphasis' },
  { tag: [tags.url, tags.link], class: 'md-link' },
  { tag: [tags.monospace, tags.processingInstruction, tags.meta], class: 'md-code' },
  { tag: [tags.quote, tags.list, tags.contentSeparator], class: 'md-punctuation' },
])

const quickSnippets = [
  { label: 'Heading', apply: '## Heading' },
  { label: 'Checklist', apply: '- [ ] To do' },
  { label: 'Callout', apply: '> [!NOTE]\n> Write a note.' },
  { label: 'Table of contents', apply: '[[TOC]]' },
  { label: 'Table', apply: '| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |' },
]

interface Props {
  initial: string
  lineNumberDisplay: boolean
  wordWrap: boolean
  onChange(value: string): void
  onLocation(location: SourceLocation): void
  onReady(view: EditorView | null): void
}

export function replaceSource(view: EditorView | null, source: string, origin: 'visual' | 'metadata', recordHistory = true) {
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
    changes: { from: start, to: beforeEnd, insert: source.slice(start, afterEnd) },
    annotations: [
      ...(recordHistory ? [isolateHistory.of('full')] : [Transaction.addToHistory.of(false)]),
      Transaction.userEvent.of(origin === 'visual' ? 'folio.visual' : 'folio.metadata'),
    ],
  })
}

export function SourceEditor(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const settings = useRef(new Compartment())
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    if (!container.current) return
    const configuration = () => [
      ...(latest.current.lineNumberDisplay ? [lineNumbers(), highlightActiveLineGutter()] : []),
      ...(latest.current.wordWrap ? [EditorView.lineWrapping] : []),
    ]
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: latest.current.initial,
        extensions: [
          settings.current.of(configuration()), history(), highlightActiveLine(), highlightSelectionMatches(),
          markdown({ base: markdownLanguage, extensions: [GFM] }), syntaxHighlighting(syntax), bracketMatching(), closeBrackets(), indentOnInput(),
          autocompletion({ addToOptions: [], override: [context => {
            const word = context.matchBefore(/\/[a-zA-Z -]*/)
            if (!word && !context.explicit) return null
            return { from: word?.from ?? context.pos, options: quickSnippets }
          }] }),
          keymap.of([{ key: 'Mod-Shift-z', run: redo, preventDefault: true }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
          linter(current => validateSource(current.state.doc.toString()), { delay: 400 }), lintGutter(),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown source editor', 'aria-multiline': 'true' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && update.transactions.some(transaction => !transaction.isUserEvent('folio.visual'))) {
              latest.current.onChange(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head
              const line = update.state.doc.lineAt(head)
              latest.current.onLocation({ line: line.number, column: head - line.from + 1 })
            }
          }),
        ],
      }),
    })
    view.current = editor
    latest.current.onReady(editor)
    return () => { latest.current.onReady(null); view.current = null; editor.destroy() }
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: settings.current.reconfigure([
      ...(props.lineNumberDisplay ? [lineNumbers(), highlightActiveLineGutter()] : []),
      ...(props.wordWrap ? [EditorView.lineWrapping] : []),
    ]) })
  }, [props.lineNumberDisplay, props.wordWrap])

  return <div ref={container} className="source-editor" />
}
