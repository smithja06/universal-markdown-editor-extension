import type { JSONContent } from '@tiptap/core'
import { exportLimits, safePdfLink, type Align, type ExportNotice, type Inline, type PrintBlock, type PrintDocument, type TableCell, type TextRun } from './model'

export interface RasterAsset { src: string; width: number; height: number }
export interface MarkdownAssets {
  /** Returns a PNG or JPEG data URL for an image reference, or undefined when it cannot be read locally. */
  image?(src: string, signal?: AbortSignal): Promise<RasterAsset | undefined>
  /** Renders a Mermaid diagram to a raster image. */
  diagram?(source: string, signal?: AbortSignal): Promise<RasterAsset | undefined>
}

interface Counters { math: number; diagrams: number; diagramFailures: number; images: number; missingImages: number; raw: number; unsupportedMarks: Set<string>; links: number; wiki: number }

const alignment = (value: unknown): Align | undefined => value === 'center' || value === 'right' ? value : value === 'left' ? 'left' : undefined
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Builds the print model from Folio's rendered Markdown tree, so authored HTML images, callouts,
 * diagrams and math use the same interpretation as the Visual editor.
 */
export async function printMarkdown(title: string, document: JSONContent, assets: MarkdownAssets = {}, signal?: AbortSignal): Promise<PrintDocument> {
  const counters: Counters = { math: 0, diagrams: 0, diagramFailures: 0, images: 0, missingImages: 0, raw: 0, unsupportedMarks: new Set(), links: 0, wiki: 0 }
  const headings: { level: number; text: string }[] = []
  const contents = new Set<PrintBlock>()
  const inlineImages: JSONContent[] = []

  function inlines(nodes: JSONContent[] | undefined): Inline[] {
    const result: Inline[] = []
    for (const node of nodes ?? []) {
      if (node.type === 'hardBreak') { result.push({ break: true }); continue }
      if (node.type === 'inlineMath') { counters.math++; result.push({ text: String(node.attrs?.value ?? ''), code: true }); continue }
      if (node.type === 'rawInline') { counters.raw++; result.push({ text: String(node.attrs?.value ?? ''), code: true }); continue }
      if (node.type === 'wikiLink') { counters.wiki++; result.push({ text: String(node.attrs?.label || node.attrs?.value || '') }); continue }
      if (node.type === 'image') { inlineImages.push(node); continue }
      if (node.type !== 'text' || !node.text) continue
      const run: TextRun = { text: node.text }
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') run.bold = true
        else if (mark.type === 'italic') run.italic = true
        else if (mark.type === 'underline') run.underline = true
        else if (mark.type === 'strike') run.strike = true
        else if (mark.type === 'code') run.code = true
        else if (mark.type === 'link') {
          const href = String(mark.attrs?.href ?? '')
          if (safePdfLink(href)) run.link = href
          else counters.links++
        } else if (mark.type !== 'textStyle') counters.unsupportedMarks.add(mark.type)
      }
      result.push(run)
    }
    return result
  }

  async function image(node: JSONContent): Promise<PrintBlock> {
    counters.images++
    const src = String(node.attrs?.src ?? '')
    const alt = String(node.attrs?.alt ?? '')
    const caption = typeof node.attrs?.caption === 'string' && node.attrs.caption ? node.attrs.caption : undefined
    let asset: RasterAsset | undefined
    if (counters.images <= exportLimits.images) asset = await assets.image?.(src, signal).catch(() => undefined)
    signal?.throwIfAborted()
    if (!asset) {
      counters.missingImages++
      return { kind: 'paragraph', inlines: [{ text: `[Image unavailable${alt ? ': ' + alt : ''}]`, italic: true }] }
    }
    const width = Number(node.attrs?.width)
    const scale = Number.isFinite(width) && width > 0 ? width / asset.width : 1
    return { kind: 'image', src: asset.src, alt, caption, width: asset.width * scale, height: asset.height * scale, align: alignment(node.attrs?.align) }
  }

  async function flushImages(into: PrintBlock[]) {
    while (inlineImages.length) into.push(await image(inlineImages.shift()!))
  }

  async function blocks(nodes: JSONContent[] | undefined): Promise<PrintBlock[]> {
    const result: PrintBlock[] = []
    for (const node of nodes ?? []) {
      signal?.throwIfAborted()
      switch (node.type) {
        case 'paragraph': {
          const content = inlines(node.content)
          if (content.length || !inlineImages.length) result.push({ kind: 'paragraph', inlines: content, align: alignment(node.attrs?.textAlign) })
          await flushImages(result)
          break
        }
        case 'heading': {
          const content = inlines(node.content)
          const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
          headings.push({ level, text: content.map(item => 'text' in item ? item.text : ' ').join('') })
          result.push({ kind: 'heading', level, inlines: content })
          await flushImages(result)
          break
        }
        case 'blockquote': result.push({ kind: 'quote', blocks: await blocks(node.content) }); break
        case 'callout': {
          const kind = String(node.attrs?.kind ?? 'note')
          result.push({ kind: 'quote', label: kind.charAt(0).toUpperCase() + kind.slice(1), blocks: await blocks(node.content) })
          break
        }
        case 'bulletList': case 'orderedList': case 'taskList': {
          const items = []
          for (const item of node.content ?? []) items.push({ blocks: await blocks(item.content), checked: node.type === 'taskList' ? !!item.attrs?.checked : undefined })
          result.push({ kind: 'list', ordered: node.type === 'orderedList', start: node.attrs?.start ?? 1, items })
          break
        }
        case 'codeBlock': result.push({ kind: 'code', text: (node.content ?? []).map(child => child.text ?? '').join('') }); break
        case 'horizontalRule': result.push({ kind: 'rule' }); break
        case 'blockMath': counters.math++; result.push({ kind: 'code', text: String(node.attrs?.value ?? '') }); break
        case 'rawBlock': counters.raw++; result.push({ kind: 'code', text: String(node.attrs?.value ?? '') }); break
        case 'mermaid': {
          const source = String(node.attrs?.value ?? '')
          counters.diagrams++
          const rendered = counters.diagrams <= exportLimits.diagrams ? await assets.diagram?.(source, signal).catch(() => undefined) : undefined
          signal?.throwIfAborted()
          if (rendered) result.push({ kind: 'image', src: rendered.src, alt: 'Mermaid diagram', width: rendered.width, height: rendered.height })
          else { counters.diagramFailures++; result.push({ kind: 'code', text: source }) }
          break
        }
        case 'toc': {
          const placeholder: PrintBlock = { kind: 'list', ordered: false, items: [] }
          contents.add(placeholder)
          result.push(placeholder)
          break
        }
        case 'table': {
          const rows: TableCell[][] = (node.content ?? []).map(row => (row.content ?? []).map(cell => ({
            inlines: (cell.content ?? []).flatMap((paragraph, index) => [...(index ? [{ break: true } as const] : []), ...inlines(paragraph.content)]),
            colSpan: Number(cell.attrs?.colspan) > 1 ? Number(cell.attrs?.colspan) : undefined,
            rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
            align: alignment(cell.content?.[0]?.attrs?.textAlign),
          })))
          const header = node.content?.[0]?.content?.every(cell => cell.type === 'tableHeader') ?? false
          result.push({ kind: 'table', header, rows })
          await flushImages(result)
          break
        }
        default:
          if (node.content) result.push(...await blocks(node.content))
      }
    }
    return result
  }

  const body = await blocks(document.content)
  // Fill table-of-contents placeholders after all headings are known.
  for (const placeholder of contents) {
    if (placeholder.kind === 'list') placeholder.items = headings.map(heading => ({ blocks: [{ kind: 'paragraph', inlines: [{ text: '\u2003'.repeat(heading.level - 1) + heading.text }] }] }))
  }

  const notices: ExportNotice[] = [{ feature: 'Page layout', effect: 'approximated',
    message: 'The PDF uses Folio’s print typography. Text reflows to the selected page size, and page breaks follow the content.' }]
  if (document.attrs?.frontMatter) notices.push({ feature: 'Front matter', effect: 'omitted', message: 'YAML front matter is document metadata and is not printed.' })
  if (counters.math) notices.push({ feature: 'Math', effect: 'approximated', message: `${plural(counters.math, 'math expression')} printed as TeX source text.` })
  if (counters.diagramFailures) notices.push({ feature: 'Mermaid diagrams', effect: 'approximated', message: `${plural(counters.diagramFailures, 'diagram')} could not be rendered and ${counters.diagramFailures === 1 ? 'is' : 'are'} printed as Mermaid source.` })
  if (counters.diagrams > counters.diagramFailures) notices.push({ feature: 'Mermaid diagrams', effect: 'approximated', message: `${plural(counters.diagrams - counters.diagramFailures, 'diagram')} printed as raster images. Diagram text is not selectable.` })
  if (counters.missingImages) notices.push({ feature: 'Images', effect: 'omitted', message: `${plural(counters.missingImages, 'image')} could not be read locally and ${counters.missingImages === 1 ? 'is' : 'are'} replaced by a labelled placeholder. Folio does not download remote images.` })
  if (counters.images > counters.missingImages) notices.push({ feature: 'Images', effect: 'preserved', message: `${plural(counters.images - counters.missingImages, 'image')} embedded. The PDF is not tagged, so alt text is not stored in it.` })
  if (counters.raw) notices.push({ feature: 'HTML and unsupported syntax', effect: 'approximated', message: `${plural(counters.raw, 'preserved source item')} printed as literal source text.` })
  if (counters.links) notices.push({ feature: 'Links', effect: 'approximated', message: `${plural(counters.links, 'link')} to headings, files or unsupported destinations printed as plain text.` })
  if (counters.unsupportedMarks.size) notices.push({ feature: 'Formatting', effect: 'approximated', message: `${[...counters.unsupportedMarks].sort().join(', ')} formatting printed as plain text.` })
  return { title, source: 'markdown', blocks: body, notices }
}
