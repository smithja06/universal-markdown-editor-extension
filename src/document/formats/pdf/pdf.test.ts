// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { activeContentPdf, malformedPdf, passwordPdf, pdfFixture, searchablePages } from '../../../../tests/fixtures/pdfFixtures'
import { nodePdfRuntime } from '../../../../tests/fixtures/pdfRuntime'
import { inspectPdf, openPdf } from './engine'
import { looksLikePdf, pdfLimits, PdfInputError, pdfNotices } from './model'
import { findInPage, hasText, itemRanges, pageText } from './text'

async function rejection(promise: Promise<unknown>) {
  try { await promise } catch (error) { return error }
  throw new Error('Expected a rejection.')
}

describe('PDF identification and limits', () => {
  it('requires a PDF header near the start of the file', () => {
    expect(looksLikePdf(pdfFixture([['x']]))).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('junk\n%PDF-1.4\n'))).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('PK\u0003\u0004 not a pdf'))).toBe(false)
    expect(looksLikePdf(new Uint8Array(2048).fill(32))).toBe(false)
  })

  it('rejects oversized input before parsing', async () => {
    const error = await rejection(openPdf(new Uint8Array(pdfLimits.fileBytes + 1), await nodePdfRuntime()))
    expect(error).toBeInstanceOf(PdfInputError)
    expect((error as PdfInputError).code).toBe('size-limit')
  })

  it('rejects a document above the page limit and releases it', async () => {
    const pages = Array.from({ length: pdfLimits.pages + 1 }, () => ['p'])
    const error = await rejection(openPdf(pdfFixture(pages), await nodePdfRuntime()))
    expect((error as PdfInputError).code).toBe('page-limit')
  }, 60_000)

  it('rejects malformed and non-PDF content', async () => {
    const runtime = await nodePdfRuntime()
    expect(((await rejection(openPdf(malformedPdf(), runtime))) as PdfInputError).code).toBe('invalid-pdf')
    expect(((await rejection(openPdf(new TextEncoder().encode('hello'), runtime))) as PdfInputError).code).toBe('invalid-pdf')
  })

  it('reports password-protected documents as unsupported', async () => {
    const error = await rejection(inspectPdf(passwordPdf(), await nodePdfRuntime()))
    expect((error as PdfInputError).code).toBe('encrypted')
    expect((error as Error).message).toMatch(/password-protected/)
  })

  it('stops opening when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(openPdf(pdfFixture([['x']]), await nodePdfRuntime(), controller.signal)).rejects.toThrow()
  })
})

describe('PDF pages and text', () => {
  it('reads page metadata and searchable text without modifying the input', async () => {
    const bytes = pdfFixture(searchablePages, { width: 595, height: 842 })
    const copy = bytes.slice()
    const handle = await openPdf(bytes, await nodePdfRuntime())
    try {
      expect(handle.pageCount).toBe(3)
      const page = await handle.page(1)
      expect(page.getViewport({ scale: 1 }).width).toBeCloseTo(595)
      expect(page.getViewport({ scale: 1 }).height).toBeCloseTo(842)
      const text = await handle.text(1)
      expect(text.text).toContain('Search target appears here: needle')
      expect(hasText(text)).toBe(true)
      const matches = findInPage(text, 'NEEDLE')
      expect(matches).toHaveLength(1)
      expect(text.text.slice(matches[0].start, matches[0].end)).toBe('needle')
      const ranges = itemRanges(text, matches[0])
      expect(ranges.length).toBeGreaterThan(0)
      expect(ranges.map(range => text.text.slice(text.starts[range.item] + range.from, text.starts[range.item] + range.to)).join('')).toBe('needle')
    } finally { await handle.destroy() }
    expect(bytes).toEqual(copy)
    expect(handle.destroyed).toBe(true)
    await expect(handle.page(0)).rejects.toThrow(/closed/)
  })

  it('identifies textless image pages', async () => {
    const handle = await openPdf(pdfFixture([null, ['visible words']]), await nodePdfRuntime())
    try {
      expect(hasText(await handle.text(0))).toBe(false)
      expect(findInPage(await handle.text(0), 'visible')).toEqual([])
      expect(hasText(await handle.text(1))).toBe(true)
    } finally { await handle.destroy() }
  })

  it('reports active content as inert features', async () => {
    const summary = await inspectPdf(activeContentPdf(), await nodePdfRuntime())
    expect(summary.features.scripts).toBe(true)
    expect(summary.features.forms).toBe(true)
    expect(summary.features.attachments).toBe(true)
    expect(pdfNotices(summary.features).join(' ')).toMatch(/does not run them.*cannot be filled.*not opened/)
    expect((globalThis as { folioPdfScriptRan?: boolean }).folioPdfScriptRan).toBeUndefined()
  })
})

describe('PDF text index', () => {
  it('folds case and whitespace and maps matches back to items', () => {
    const page = pageText(0, [{ str: 'Hello', hasEOL: true }, { str: 'WORLD  wide' }, { type: 'beginMarkedContent' }, { str: ' web' }], 1000)
    expect(page.text).toBe('Hello\nWORLD  wide web')
    const [match] = findInPage(page, 'hello world')
    expect(page.text.slice(match.start, match.end)).toBe('Hello\nWORLD')
    expect(itemRanges(page, match)).toEqual([{ item: 0, from: 0, to: 5 }, { item: 1, from: 0, to: 5 }])
    expect(findInPage(page, 'wide web')).toHaveLength(1)
    expect(findInPage(page, '   ')).toEqual([])
  })

  it('bounds extracted text', () => {
    const page = pageText(0, [{ str: 'abcdef' }, { str: 'ghi' }], 4)
    expect(page.text).toBe('abcd')
    expect(page.truncated).toBe(true)
    expect(page.lengths).toEqual([4, 0])
  })
})
