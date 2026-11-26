// @vitest-environment jsdom
import type { JSONContent } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { expect, test } from 'vitest'
import { writeDocx } from './write'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rels = 'http://schemas.openxmlformats.org/package/2006/relationships'
const types = 'http://schemas.openxmlformats.org/package/2006/content-types'
const xml = 'http://www.w3.org/XML/1998/namespace'

function document(...content: JSONContent[]): JSONContent { return { type: 'doc', content } }
function paragraph(...content: JSONContent[]): JSONContent { return { type: 'paragraph', content } }
function text(value: string): JSONContent { return { type: 'text', text: value } }

function openParts(model: JSONContent) {
  const entries = unzipSync(writeDocx(model))
  return (name: string) => {
    expect(entries[name], name).toBeDefined()
    const part = new DOMParser().parseFromString(strFromU8(entries[name]), 'application/xml')
    expect(part.documentElement.localName).not.toBe('parsererror')
    return part
  }
}

function elements(root: Document | Element, name: string, namespace = word): Element[] {
  return [...root.getElementsByTagNameNS(namespace, name)]
}

function wordValue(node: Element, attribute = 'val') { return node.getAttributeNS(word, attribute) }

test('registers the Word document, styles, and numbering parts with valid package relationships', () => {
  const part = openParts(document({
    type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('item'))] }],
  }))
  const [main] = elements(part('_rels/.rels'), 'Relationship', rels)
  expect(main.getAttribute('Type')).toBe(office + '/officeDocument')
  expect(main.getAttribute('Target')).toBe('word/document.xml')
  const overrides = Object.fromEntries(elements(part('[Content_Types].xml'), 'Override', types)
    .map(node => [node.getAttribute('PartName'), node.getAttribute('ContentType')]))
  expect(overrides).toMatchObject({
    '/word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    '/word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
    '/word/numbering.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  })
  const documentRels = elements(part('word/_rels/document.xml.rels'), 'Relationship', rels)
  expect(documentRels.map(node => [node.getAttribute('Type'), node.getAttribute('Target')])).toEqual([
    [office + '/styles', 'styles.xml'],
    [office + '/numbering', 'numbering.xml'],
  ])
  expect(part('word/numbering.xml').documentElement.namespaceURI).toBe(word)
  expect(part('word/styles.xml').documentElement.namespaceURI).toBe(word)
  expect(part('word/document.xml').documentElement.namespaceURI).toBe(word)
})

test('writes heading levels as named Word styles with matching outline levels', () => {
  const part = openParts(document(...[1, 2, 3, 4, 5, 6].map(level => ({
    type: 'heading', attrs: { level }, content: [text('Level ' + level)],
  }))))
  const expectedStyles = ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6']
  expect(elements(part('word/document.xml'), 'pStyle').map(node => wordValue(node))).toEqual(expectedStyles)
  const headings = elements(part('word/styles.xml'), 'style')
    .filter(node => expectedStyles.includes(wordValue(node, 'styleId') ?? ''))
  expect(headings.map(node => wordValue(node, 'type'))).toEqual(Array(6).fill('paragraph'))
  expect(headings.map(node => wordValue(elements(node, 'outlineLvl')[0]))).toEqual(['0', '1', '2', '3', '4', '5'])
})

test('preserves Unicode, literal whitespace, explicit breaks, and empty paragraphs in the main document', () => {
  const first = '  café 😀 中文 & < > " \'  '
  const part = openParts(document(paragraph(text(first + '\tsecond'), { type: 'hardBreak' }, text('  end ')), paragraph()))
  const [body] = elements(part('word/document.xml'), 'body')
  const paragraphs = elements(body, 'p')
  expect(paragraphs).toHaveLength(2)
  expect(paragraphs[1].textContent).toBe('')
  const runs = elements(paragraphs[0], 'r')
  expect(runs.flatMap(run => [...run.children].map(child => child.localName))).toEqual(['t', 'tab', 't', 'br', 't'])
  const valueNodes = elements(paragraphs[0], 't')
  expect(valueNodes.map(node => node.textContent)).toEqual([first, 'second', '  end '])
  expect(valueNodes.map(node => node.getAttributeNS(xml, 'space'))).toEqual(['preserve', 'preserve', 'preserve'])
})

test('keeps bold, italic, underline and a safe external link on the same text run', () => {
  const href = 'https://example.test/café?a=1&b=2#résumé'
  const link = { type: 'link', attrs: { href } }
  const part = openParts(document(paragraph(
    { ...text('Visit '), marks: [link] },
    { ...text('Folio'), marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, link] },
  ), paragraph({ ...text('Again'), marks: [link] })))
  const links = elements(part('word/document.xml'), 'hyperlink')
  expect(links.map(element => element.textContent)).toEqual(['Visit Folio', 'Again'])
  const [plainRun, formattedRun] = elements(links[0], 'r')
  expect(wordValue(elements(plainRun, 'rStyle')[0])).toBe('Hyperlink')
  expect(elements(plainRun, 'b')).toHaveLength(0)
  expect(elements(formattedRun, 'b')).toHaveLength(1)
  expect(elements(formattedRun, 'bCs')).toHaveLength(1)
  expect(elements(formattedRun, 'i')).toHaveLength(1)
  expect(elements(formattedRun, 'iCs')).toHaveLength(1)
  expect(wordValue(elements(formattedRun, 'u')[0])).toBe('single')
  const relationship = elements(part('word/_rels/document.xml.rels'), 'Relationship', rels)
    .find(node => node.getAttribute('Type') === office + '/hyperlink')
  expect(relationship?.getAttribute('TargetMode')).toBe('External')
  expect(relationship?.getAttribute('Target')).toBe(href)
  expect(links.map(node => node.getAttributeNS(office, 'id'))).toEqual(Array(2).fill(relationship?.getAttribute('Id')))
})

test('preserves run properties on an explicit line break', () => {
  const part = openParts(document(paragraph(text('First'), { type: 'hardBreak', marks: [{ type: 'bold' }] }, text('Second'))))
  const [lineBreak] = elements(part('word/document.xml'), 'br')
  expect(elements(lineBreak.parentElement!, 'b')).toHaveLength(1)
})

test('rejects UTF-8 XML parts that would exceed Folio’s 8 MiB import limit', () => {
  expect(() => writeDocx(document(paragraph(text('語'.repeat(2_800_000))))))
    .toThrow(/DOCX XML part exceeds/)
})

test('rejects a text run whose tab elements exceed the import complexity limit', () => {
  expect(() => writeDocx(document(paragraph(text('\t'.repeat(240_001))))))
    .toThrow(/DOCX XML element limit/)
})

test('numbers each simple list independently, including adjacent ordered lists with different starting values', () => {
  function list(type: string, items: string[], start?: number): JSONContent {
    return {
      type, attrs: start === undefined ? undefined : { start },
      content: items.map(item => ({ type: 'listItem', content: [paragraph(text(item))] })),
    }
  }
  const part = openParts(document(list('bulletList', ['bullet']), list('orderedList', ['third', 'fourth'], 3), list('orderedList', ['first'])))
  const paragraphs = elements(part('word/document.xml'), 'p')
  expect(paragraphs.map(node => node.textContent)).toEqual(['bullet', 'third', 'fourth', 'first'])
  const ids = paragraphs.map(node => wordValue(elements(node, 'numId')[0]))
  expect(ids[1]).toBe(ids[2])
  expect(new Set([ids[0], ids[1], ids[3]]).size).toBe(3)
  expect(paragraphs.every(node => wordValue(elements(node, 'ilvl')[0]) === '0')).toBe(true)
  const numbering = part('word/numbering.xml')
  const kinds = ids.map(id => {
    const instance = elements(numbering, 'num').find(node => wordValue(node, 'numId') === id)!
    const abstractId = wordValue(elements(instance, 'abstractNumId')[0])
    const definition = elements(numbering, 'abstractNum').find(node => wordValue(node, 'abstractNumId') === abstractId)!
    const [level] = elements(definition, 'lvl')
    const start = elements(instance, 'startOverride')[0] ?? elements(level, 'start')[0]
    return [wordValue(elements(level, 'numFmt')[0]), wordValue(start)]
  })
  expect(kinds).toEqual([['bullet', '1'], ['decimal', '3'], ['decimal', '3'], ['decimal', '1']])
})

test('produces a rectangular Word table with header row semantics and separate cell paragraphs', () => {
  const cell = (type: string, ...lines: string[]): JSONContent => ({
    type, content: lines.map(line => line ? paragraph(text(line)) : paragraph()),
  })
  const part = openParts(document({
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('tableHeader', 'A'), cell('tableHeader', 'B')] },
      { type: 'tableRow', content: [cell('tableCell', 'one', 'two'), cell('tableCell', '')] },
    ],
  }))
  const [table] = elements(part('word/document.xml'), 'tbl')
  expect(elements(table, 'gridCol')).toHaveLength(2)
  const [header, data] = elements(table, 'tr')
  expect(elements(header, 'tblHeader')).toHaveLength(1)
  expect(elements(data, 'tblHeader')).toHaveLength(0)
  expect([header, data].map(row => elements(row, 'tc').map(entry => elements(entry, 'p').map(p => p.textContent))))
    .toEqual([[['A'], ['B']], [['one', 'two'], ['']]])
})

test('keeps adjacent tables distinct when Word opens them', () => {
  function table(value: string): JSONContent {
    return { type: 'table', content: [{
      type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text(value))] }],
    }] }
  }
  const part = openParts(document(table('First'), table('Second')))
  const styles = elements(part('word/document.xml'), 'tblStyle').map(node => wordValue(node))
  expect(styles).toHaveLength(2)
  expect(new Set(styles).size).toBe(2)
  const tableStyles = elements(part('word/styles.xml'), 'style')
    .filter(node => wordValue(node, 'type') === 'table')
    .map(node => wordValue(node, 'styleId'))
  expect(tableStyles).toEqual(expect.arrayContaining(styles))
})

test.each([
  ['unsupported block', document({ type: 'image', attrs: { src: 'https://example.test/image.png' } })],
  ['unsupported mark', document(paragraph({ ...text('strike'), marks: [{ type: 'strike' }] }))],
  ['invalid heading level', document({ type: 'heading', attrs: { level: 7 }, content: [text('Invalid')] })],
  ['unsafe link', document(paragraph({ ...text('script'), marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }))],
  ['invisible XML control', document(paragraph(text('before\u0000after')))],
  ['unpaired Unicode surrogate', document(paragraph(text('bad\uD800')))],
  ['non-rectangular table', document({ type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph()] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph()] }, { type: 'tableCell', content: [paragraph()] }] },
  ] })],
  ['merged table cell', document({ type: 'table', content: [{
    type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [paragraph()] }],
  }] })],
  ['mixed header and data cells', document({ type: 'table', content: [{
    type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph()] }, { type: 'tableCell', content: [paragraph()] }],
  }] })],
  ['Word table beyond 63 columns', document({ type: 'table', content: [{
    type: 'tableRow', content: Array.from({ length: 64 }, () => ({ type: 'tableCell', content: [paragraph()] })),
  }] })],
  ['multiple paragraphs in a list item', document({ type: 'bulletList', content: [{
    type: 'listItem', content: [paragraph(), paragraph(text('would become a new item'))],
  }] })],
] satisfies [string, JSONContent][])('rejects %s before creating a DOCX package', (_reason, input) => {
  expect(() => writeDocx(input)).toThrow()
})

test('writes column widths as a fixed Word grid that reimports to the same pixels', async () => {
  const { readDocx } = await import('./read')
  const { canonicalDocx } = await import('./model')
  const cell = (value: string, width?: number, type = 'tableCell'): JSONContent =>
    ({ type, ...(width ? { attrs: { colwidth: [width] } } : {}), content: [paragraph(text(value))] })
  const model = document({ type: 'table', content: [
    { type: 'tableRow', content: [cell('Name', 180, 'tableHeader'), cell('Amount', 96, 'tableHeader')] },
    // A row added after resizing carries no widths. The column width still applies.
    { type: 'tableRow', content: [cell('Coffee'), cell('4.50')] },
  ] })
  const part = openParts(model)('word/document.xml')
  expect(elements(part, 'gridCol').map(column => column.getAttributeNS(word, 'w'))).toEqual(['2700', '1440'])
  expect(elements(part, 'tblLayout')[0]?.getAttributeNS(word, 'type')).toBe('fixed')
  expect(elements(part, 'tblW')[0]?.getAttributeNS(word, 'w')).toBe('4140')
  expect(elements(part, 'tcW').map(width => width.getAttributeNS(word, 'w'))).toEqual(['2700', '1440', '2700', '1440'])
  // Word requires tblLayout after tblBorders inside tblPr.
  expect([...elements(part, 'tblPr')[0].children].map(child => child.localName)).toEqual(['tblStyle', 'tblW', 'tblBorders', 'tblLayout'])
  const reread = readDocx(writeDocx(model))
  expect(reread.issues.map(issue => issue.feature)).not.toContain('Table formatting')
  expect(reread.issues.map(issue => issue.feature)).not.toContain('Table cell formatting')
  expect(reread.document).toEqual(canonicalDocx(model))
  expect(reread.document.content?.[0].content?.[1].content?.[0].attrs).toEqual({ colwidth: [180] })
})

test('keeps automatic columns beside resized ones and rejects widths outside the editable range', async () => {
  const { readDocx } = await import('./read')
  const { canonicalDocx } = await import('./model')
  const model = document({ type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', attrs: { colwidth: [150] }, content: [paragraph(text('Wide'))] },
    { type: 'tableCell', attrs: { colwidth: null }, content: [paragraph(text('Auto'))] },
  ] }] })
  const part = openParts(model)('word/document.xml')
  expect(elements(part, 'tblLayout')).toHaveLength(0)
  expect(elements(part, 'tblW')[0]?.getAttributeNS(word, 'type')).toBe('auto')
  expect(readDocx(writeDocx(model)).document).toEqual(canonicalDocx(model))
  expect(() => canonicalDocx(document({ type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', attrs: { colwidth: [5] }, content: [paragraph(text('Narrow'))] }] }] }))).toThrow(/24 to 2000/)
})
