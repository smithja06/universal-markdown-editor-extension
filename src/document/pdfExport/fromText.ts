import type { JSONContent } from '@tiptap/core'
import type { DocxIssue } from '../formats/docx/model'
import { safeDocxLink } from '../formats/docx/model'
import type { ExportNotice, Inline, PrintBlock, PrintDocument, TextRun } from './model'

/** TXT stays literal: no Markdown interpretation, whitespace and blank lines kept. */
export function printTxt(title: string, source: string): PrintDocument {
  const notices: ExportNotice[] = [{ feature: 'Plain text layout', effect: 'approximated',
    message: 'Text uses a monospaced font. Lines longer than the page width wrap at a fixed column, and tabs expand to 8-column stops.' }]
  return { title, source: 'txt', blocks: [{ kind: 'literal', text: source }], notices }
}

function docxInlines(nodes: JSONContent[] | undefined): Inline[] {
  const inlines: Inline[] = []
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') { inlines.push({ break: true }); continue }
    if (node.type !== 'text' || !node.text) continue
    const run: TextRun = { text: node.text }
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') run.bold = true
      else if (mark.type === 'italic') run.italic = true
      else if (mark.type === 'underline') run.underline = true
      else if (mark.type === 'link' && typeof mark.attrs?.href === 'string' && safeDocxLink(mark.attrs.href)) run.link = mark.attrs.href
    }
    inlines.push(run)
  }
  return inlines
}

function docxBlocks(nodes: JSONContent[] | undefined): PrintBlock[] {
  const blocks: PrintBlock[] = []
  for (const node of nodes ?? []) {
    if (node.type === 'paragraph') blocks.push({ kind: 'paragraph', inlines: docxInlines(node.content) })
    else if (node.type === 'heading') blocks.push({ kind: 'heading', level: Number(node.attrs?.level) || 1, inlines: docxInlines(node.content) })
    else if (node.type === 'bulletList' || node.type === 'orderedList') {
      blocks.push({ kind: 'list', ordered: node.type === 'orderedList', start: node.attrs?.start ?? 1,
        items: (node.content ?? []).map(item => ({ blocks: docxBlocks(item.content) })) })
    } else if (node.type === 'table') {
      const rows = node.content ?? []
      blocks.push({ kind: 'table', header: rows[0]?.content?.[0]?.type === 'tableHeader',
        rows: rows.map(row => (row.content ?? []).map(cell => ({ inlines: (cell.content ?? []).flatMap((paragraph, index) =>
          [...(index ? [{ break: true } as const] : []), ...docxInlines(paragraph.content)]) }))) })
    }
  }
  return blocks
}

/** Builds from the structured Phase 7B model rather than through Markdown. */
export function printDocx(title: string, document: JSONContent, issues: readonly DocxIssue[]): PrintDocument {
  const notices: ExportNotice[] = issues.filter(issue => issue.effect !== 'preserved').map(issue => ({
    feature: issue.feature, location: issue.location, effect: 'omitted' as const,
    message: 'Kept only in the original DOCX. ' + issue.message,
  }))
  notices.push({ feature: 'Page layout and fonts', effect: 'approximated',
    message: 'The PDF reflows the supported DOCX content with Folio’s fonts, page size and margins. Word pagination, styles, line breaks and fonts can differ.' })
  return { title, source: 'docx', blocks: docxBlocks(document.content), notices }
}
