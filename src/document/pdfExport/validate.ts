import { needsGlyph } from './coverage'
import { openPdf, type PdfRuntime } from '../formats/pdf/engine'
import { literalColumns, literalSize, printedText, wrapLiteral, type Coverage } from './layout'
import { exportLimits, pageDimensions, runText, type PdfPageOptions, type PrintBlock, type PrintDocument } from './model'

export interface PdfValidation { pageCount: number; width: number; height: number }

/** Text fragments that must appear, in order, in the generated PDF's embedded text. */
export function expectedFragments(print: PrintDocument, coverage: Coverage, options: PdfPageOptions) {
  const fragments: string[] = []
  // Compare the text as printed, including code-point markers for characters no bundled font can draw.
  const keep = (text: string, mono: boolean) => {
    let value = ''
    for (const character of printedText(text, coverage, mono)) {
      if (/\s/u.test(character) || !needsGlyph(character.codePointAt(0)!)) continue
      value += character
    }
    if (value) fragments.push(value)
  }
  const visit = (blocks: PrintBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'heading' || block.kind === 'paragraph') {
        // Text and inline code use different fonts but extract in reading order.
        keep(runText(block.inlines), false)
      } else if (block.kind === 'list') block.items.forEach(item => visit(item.blocks))
      else if (block.kind === 'quote') { if (block.label) keep(block.label, false); visit(block.blocks) }
      else if (block.kind === 'code') keep(block.text, true)
      else if (block.kind === 'literal') {
        for (const line of wrapLiteral(block.text, literalColumns(options, literalSize)).lines) keep(line, true)
      } else if (block.kind === 'table') block.rows.forEach(row => row.forEach(cell => keep(runText(cell.inlines), false)))
      else if (block.kind === 'image' && block.caption) keep(block.caption, false)
    }
  }
  visit(print.blocks)
  return fragments
}

/**
 * Reopens a generated PDF with the viewer engine and checks its structure, page size and text order.
 * A failure means the copy is not delivered.
 */
export async function validatePdf(bytes: Uint8Array, print: PrintDocument, options: PdfPageOptions, coverage: Coverage, runtime: PdfRuntime, signal?: AbortSignal): Promise<PdfValidation> {
  const handle = await openPdf(bytes, runtime, signal).catch(() => { throw new Error('The generated PDF could not be reopened for validation.') })
  try {
    if (handle.pageCount > exportLimits.pages) throw new Error(`The PDF would have more than ${exportLimits.pages.toLocaleString('en-US')} pages.`)
    const first = (await handle.page(0)).getViewport({ scale: 1 })
    const expected = pageDimensions(options)
    if (Math.abs(first.width - expected.width) > 1 || Math.abs(first.height - expected.height) > 1) throw new Error('The generated PDF has an unexpected page size.')
    let text = ''
    for (let index = 0; index < handle.pageCount; index++) {
      signal?.throwIfAborted()
      let page = Array.from((await handle.text(index, signal)).text).filter(character => {
        const point = character.codePointAt(0)!
        return !/\s/u.test(character) && needsGlyph(point) && (coverage.body.has(point) || coverage.mono.has(point) || coverage.symbols.has(point))
      }).join('')
      const footer = `${index + 1}/${handle.pageCount}`
      const at = page.lastIndexOf(footer)
      if (at >= 0) page = page.slice(0, at) + page.slice(at + footer.length)
      text += page
    }
    let position = 0
    for (const fragment of expectedFragments(print, coverage, options)) {
      const found = text.indexOf(fragment, position)
      if (found < 0) throw new Error('The generated PDF did not contain all exported text in reading order.')
      position = found + fragment.length
    }
    return { pageCount: handle.pageCount, width: first.width, height: first.height }
  } finally { await handle.destroy() }
}
