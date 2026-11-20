import { useEffect, useRef } from 'react'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint'
import { readMetadata } from '../document/metadata'

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

function validateSource(text: string): Diagnostic[] {
  const issues: Diagnostic[] = []
  const yaml = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  if (yaml) {
    const error = readMetadata(yaml[1]).error
    if (error) issues.push({ from: 0, to: Math.max(yaml[0].length - 1, 0), severity: 'error', message: error })
  }
  let opening: { char: string; length: number; from: number } | undefined
  let offset = 0
  for (const line of text.split('\n')) {
    const fence = /^ {0,3}([`]{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      const token = fence[1]
      if (opening && opening.char === token[0] && token.length >= opening.length && !fence[2].trim()) opening = undefined
      else if (!opening && (token[0] !== '`' || !fence[2].includes('`'))) opening = { char: token[0], length: token.length, from: offset }
    }
    offset += line.length + 1
  }
  if (opening) issues.push({ from: opening.from, to: opening.from + 3, severity: 'warning', message: 'This opening fence continues to the end of the document.' })
  return issues
}

interface Props {
  initial: string
  lineNumberDisplay: boolean
  wordWrap: boolean
  onChange(value: string): void
  onLocation(location: SourceLocation): void
  onReady(view: EditorView | null): void
}

export function replaceSource(view: EditorView | null, source: string, origin: 'visual' | 'metadata') {
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
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of(origin === 'visual' ? 'folio.visual' : 'folio.metadata')],
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
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
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
