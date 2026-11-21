import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { linter, lintGutter, lintKeymap } from '@codemirror/lint'
import { GFM } from '@lezer/markdown'
import { tags } from '@lezer/highlight'
import { validateSource } from './sourceDiagnostics'

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

export const sourceLanguage = [
  markdown({ base: markdownLanguage, extensions: [GFM] }), syntaxHighlighting(syntax), bracketMatching(), closeBrackets(), indentOnInput(),
  autocompletion({ addToOptions: [], override: [context => {
    const word = context.matchBefore(/\/[a-zA-Z -]*/)
    if (!word && !context.explicit) return null
    return { from: word?.from ?? context.pos, options: quickSnippets }
  }] }),
  Prec.high(keymap.of(closeBracketsKeymap)), keymap.of([...completionKeymap, ...lintKeymap]),
  linter((view: EditorView) => validateSource(view.state.doc.toString()), { delay: 400 }), lintGutter(),
]
