// @vitest-environment node
import type { JSONContent } from '@tiptap/core'
import { expect, test } from 'vitest'
import { canonicalDocx } from './model'
import { readDocx } from './read'
import { writeDocx } from './write'

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const item = (text: string): JSONContent => ({ type: 'listItem', content: [paragraph(text)] })
const row = (type: 'tableHeader' | 'tableCell', ...values: string[]): JSONContent => ({
  type: 'tableRow', content: values.map(text => ({ type, content: [paragraph(text)] })),
})

test('the DOCX package round-trips supported structure and Unicode without a Markdown projection', () => {
  const document: JSONContent = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A café heading 🙂' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: '  #	Bold & italic  ', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { type: 'hardBreak', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'Link', marks: [{ type: 'underline' }, { type: 'link', attrs: { href: 'https://example.test/café?a=1&b=2' } }] },
    ] },
    { type: 'paragraph' },
    { type: 'bulletList', content: [item('Bullet')] },
    { type: 'orderedList', attrs: { start: 3 }, content: [item('Third'), item('Fourth')] },
    { type: 'orderedList', attrs: { start: 1 }, content: [item('First')] },
    { type: 'table', content: [row('tableHeader', 'Left', 'Right'), row('tableCell', 'one', 'two')] },
  ] }
  const result = readDocx(writeDocx(document))
  expect(canonicalDocx(result.document)).toEqual(canonicalDocx(document))
})
