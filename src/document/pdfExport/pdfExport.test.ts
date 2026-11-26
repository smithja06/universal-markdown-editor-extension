// @vitest-environment node
// pdfkit needs Node module resolution. Folio's Markdown reader gets a local DOM below.
import { JSDOM } from 'jsdom'
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { nodePdfMake } from '../../../tests/fixtures/pdfExportRuntime'
import { nodePdfRuntime } from '../../../tests/fixtures/pdfRuntime'
import { createExtensions } from '../../editor/schema'
import { openMarkdown } from '../markdown'
import { openPdf } from '../formats/pdf/engine'
import { printMarkdown } from './fromMarkdown'
import { printDocx, printTxt } from './fromText'
import { literalColumns, missingGlyphs, wrapLiteral } from './layout'
import { defaultPageOptions, type PdfPageOptions, type PrintDocument } from './model'
import { fontSetCoverage, renderPdf } from './render'
import { expectedFragments, validatePdf } from './validate'

// Load pdfkit before installing DOM globals, which it inspects at module load.
const { pdfMake, fonts } = nodePdfMake()
const dom = new JSDOM('')
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, HTMLImageElement: dom.window.HTMLImageElement })
const schema = getSchema(createExtensions())
const coverage = fontSetCoverage(fonts)

async function generate(print: PrintDocument, options: PdfPageOptions = defaultPageOptions) {
  const bytes = await renderPdf(pdfMake, print, options, fonts, coverage)
  const validation = await validatePdf(bytes, print, options, coverage, await nodePdfRuntime())
  return { bytes, validation }
}

async function pageTexts(bytes: Uint8Array) {
  const handle = await openPdf(bytes, await nodePdfRuntime())
  try { return await Promise.all(Array.from({ length: handle.pageCount }, (_, index) => handle.text(index).then(page => page.text))) }
  finally { await handle.destroy() }
}

describe('PDF export from TXT', () => {
  it('keeps literal Unicode text, whitespace and blank lines and wraps long lines at a fixed column', async () => {
    const long = 'x'.repeat(200)
    const source = '# Not a heading\n\n  indented\tTab\n**literal**  \nΩmega café → ✓\n' + long + '\n'
    const print = printTxt('notes.txt', source)
    const { bytes, validation } = await generate(print)
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
    expect(validation).toMatchObject({ pageCount: 1, width: 612, height: 792 })
    const [text] = await pageTexts(bytes)
    expect(text).toContain('# Not a heading')
    expect(text).toContain('**literal**')
    expect(text).toContain('Ωmega café → ✓')
    const columns = literalColumns(defaultPageOptions)
    expect(wrapLiteral(long, columns).lines.map(line => line.length)).toEqual([columns, columns, 200 - 2 * columns])
    expect(wrapLiteral('a\tb', 80).lines).toEqual(['a       b'])
  }, 30_000)

  it('paginates long documents on A4 landscape', async () => {
    const source = Array.from({ length: 400 }, (_, index) => `Line ${index + 1}`).join('\n')
    const options: PdfPageOptions = { size: 'a4', orientation: 'landscape', margins: 'narrow' }
    const { bytes, validation } = await generate(printTxt('long.txt', source), options)
    expect(validation.pageCount).toBeGreaterThan(5)
    expect(validation.width).toBeCloseTo(841.89, 0)
    const texts = await pageTexts(bytes)
    expect(texts.at(-1)).toContain('Line 400')
    expect(texts[0]).toMatch(/1 \/ \d+/)
  }, 30_000)
})

describe('PDF export from Markdown', () => {
  it('renders headings, marks, lists, tasks, tables, quotes, code and links and discloses approximations', async () => {
    const source = [
      '---', 'title: Hidden', '---', '', '# Report title', '', 'Text with **bold**, *italic*, ~~gone~~, `code` and a [link](https://example.com/path).',
      '', '- one', '- two', '  1. nested', '', 'Tasks:', '', '- [x] done', '- [ ] open', '', '> [!TIP]', '> Callout body', '',
      '| Name | Value |', '| --- | ---: |', '| Alpha | 1 |', '| Beta | 2 |', '', '```js', 'const answer = 42', '```', '', 'Inline $x^2$ math.', '',
      '```mermaid', 'graph TD; A-->B', '```', '', '![Remote](https://example.com/a.png)', '', '[Heading link](#report-title)', '',
    ].join('\n')
    const document = openMarkdown(source, schema).document.toJSON()
    const print = await printMarkdown('report.md', document, {})
    const kinds = print.blocks.map(block => block.kind)
    expect(kinds).toEqual(expect.arrayContaining(['heading', 'paragraph', 'list', 'quote', 'table', 'code']))
    const features = print.notices.map(notice => notice.feature)
    expect(features).toEqual(expect.arrayContaining(['Front matter', 'Math', 'Mermaid diagrams', 'Images', 'Links']))
    expect(print.notices.find(notice => notice.feature === 'Images')?.effect).toBe('omitted')
    const { bytes } = await generate(print)
    const text = (await pageTexts(bytes)).join('\n')
    expect(print.blocks.filter(block => block.kind === 'list')).toHaveLength(2)
    for (const expected of ['Report title', 'bold', 'nested', 'done', 'italic', 'const answer = 42', 'Alpha', 'Beta', 'Callout body', 'Tip', 'graph TD; A-->B', 'x^2', 'Image unavailable: Remote']) {
      expect(text).toContain(expected)
    }
    expect(text).not.toContain('title: Hidden')
    expect(new TextDecoder('latin1').decode(bytes)).toContain('https://example.com/path')
  }, 30_000)

  it('embeds local raster images and rendered diagrams supplied by the host', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='
    const document = openMarkdown('![Pixel](./pixel.png)\n\n```mermaid\ngraph TD; A-->B\n```\n', schema).document.toJSON()
    const print = await printMarkdown('images.md', document, {
      image: async () => ({ src: png, width: 40, height: 40 }), diagram: async () => ({ src: png, width: 120, height: 60 }),
    })
    expect(print.blocks.filter(block => block.kind === 'image')).toHaveLength(2)
    const { bytes } = await generate(print)
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/\/Subtype\s*\/Image/)
  }, 30_000)

  it('discloses glyphs that no bundled font can represent and still validates', async () => {
    const print = await printMarkdown('glyphs.md', openMarkdown('Smile 🙂 and 中文 with → arrow\n', schema).document.toJSON())
    const missing = missingGlyphs(print, coverage)
    expect([...missing.keys()].sort()).toEqual(['中', '文', '🙂'].sort())
    expect(missing.has('→')).toBe(false)
    expect(expectedFragments(print, coverage, defaultPageOptions).join('')).toBe('Smileandwith→arrow')
    await generate(print)
  }, 30_000)
})

describe('PDF export from DOCX', () => {
  it('uses the structured model and reports original-only content', async () => {
    const document = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Brief' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'Linked', marks: [{ type: 'link', attrs: { href: 'https://example.com/docx' } }] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third item' }] }] }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Head A' }] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Head B' }] }] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell A' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell B' }] }] }] },
      ] },
    ] }
    const print = printDocx('brief.docx', document, [{ code: 'header', feature: 'Headers', effect: 'omitted', message: 'Header text is not editable.' }])
    expect(print.notices.map(notice => notice.feature)).toEqual(['Headers', 'Page layout and fonts'])
    const { bytes } = await generate(print)
    const text = (await pageTexts(bytes)).join('\n')
    for (const expected of ['Brief', 'Bold', 'Linked', 'Third item', '3.', 'Head A', 'Cell B']) expect(text).toContain(expected)
  }, 30_000)
})

describe('PDF export validation', () => {
  it('rejects a PDF that does not match the reviewed content or page options', async () => {
    const print = printTxt('a.txt', 'Expected text')
    const { bytes } = await generate(print)
    const runtime = await nodePdfRuntime()
    await expect(validatePdf(bytes, printTxt('a.txt', 'Different text'), defaultPageOptions, coverage, runtime)).rejects.toThrow(/reading order/)
    await expect(validatePdf(bytes, print, { ...defaultPageOptions, size: 'a4' }, coverage, runtime)).rejects.toThrow(/page size/)
    await expect(validatePdf(new TextEncoder().encode('%PDF-1.7 broken'), print, defaultPageOptions, coverage, runtime)).rejects.toThrow(/reopened/)
  }, 30_000)
})
