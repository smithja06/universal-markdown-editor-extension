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

test('font, size, color, highlight, strikethrough, alignment and indentation round-trip exactly', () => {
  const styled = (text: string, attrs: Record<string, string>, ...marks: JSONContent['marks'] & object): JSONContent =>
    ({ type: 'text', text, marks: [...marks, { type: 'textStyle', attrs }] })
  const document: JSONContent = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'Centered heading' }] },
    { type: 'paragraph', attrs: { textAlign: 'right', indent: '48px' }, content: [
      styled('Georgia 20 px', { fontFamily: 'Georgia', fontSize: '20px', color: '#16724f' }, { type: 'bold' }),
      styled(' highlighted', { backgroundColor: '#ffff00' }),
      styled(' shaded', { backgroundColor: '#fff0a5' }, { type: 'strike' }),
      styled(' Inter', { fontFamily: 'Inter Variable', fontSize: '14.67px' }),
    ] },
    { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: 'Justified', marks: [{ type: 'strike' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Centered item' }] }] }] },
  ] }
  const canonical = canonicalDocx(document)
  const result = readDocx(writeDocx(document))
  expect(canonicalDocx(result.document)).toEqual(canonical)
  expect(result.issues.filter(issue => issue.effect === 'approximated')).toEqual([])
  expect(canonical.content?.[1]).toMatchObject({ attrs: { textAlign: 'right', indent: '48px' } })
})

test('the model normalizes pasted text styles and rejects layout Word cannot store', () => {
  const normalized = canonicalDocx({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pasted', marks: [
    { type: 'textStyle', attrs: { fontFamily: '"Times New Roman", serif', fontSize: '12pt', color: 'rgb(255, 0, 0)', backgroundColor: '#ff0', lineHeight: null } },
  ] }] }] })
  expect(normalized.content?.[0].content?.[0].marks).toEqual([
    { type: 'textStyle', attrs: { fontFamily: 'Times New Roman', fontSize: '16px', color: '#ff0000', backgroundColor: '#ffff00' } },
  ])
  const empty = canonicalDocx({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain', marks: [{ type: 'textStyle', attrs: { color: null } }] }] }] })
  expect(empty.content?.[0].content?.[0]).toEqual({ type: 'text', text: 'Plain' })
  expect(() => canonicalDocx({ type: 'doc', content: [{ type: 'paragraph', attrs: { indent: '30px' } }] })).toThrow('24 pixels')
  expect(() => canonicalDocx({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'start' } }] })).toThrow('alignment')
  expect(() => canonicalDocx({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { indent: '24px' } }] }] }] })).toThrow('list indentation')
})
