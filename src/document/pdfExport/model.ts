/** A paginated print model shared by Markdown, TXT and DOCX exports. It is not an editable document. */
export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  link?: string
}
export type Inline = TextRun | { break: true }
export type Align = 'left' | 'center' | 'right'
export interface TableCell { inlines: Inline[]; colSpan?: number; rowSpan?: number; align?: Align }

export type PrintBlock =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[]; align?: Align }
  | { kind: 'list'; ordered: boolean; start?: number; items: { blocks: PrintBlock[]; checked?: boolean | null }[] }
  | { kind: 'quote'; label?: string; blocks: PrintBlock[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: boolean; rows: TableCell[][] }
  | { kind: 'image'; src: string; alt: string; width: number; height: number; caption?: string; align?: Align }
  | { kind: 'rule' }
  /** Literal plain text. Lines are wrapped by the layout at a fixed column. */
  | { kind: 'literal'; text: string }

export type ExportEffect = 'preserved' | 'approximated' | 'omitted'
export interface ExportNotice { feature: string; effect: ExportEffect; message: string; location?: string }

export interface PrintDocument {
  title: string
  source: 'markdown' | 'txt' | 'docx'
  blocks: PrintBlock[]
  notices: ExportNotice[]
  /** BCP 47 language for the PDF catalog. Markdown front matter can set it; otherwise the export uses the reader's locale. */
  language?: string
}

/** A canonical BCP 47 tag, or undefined for anything Intl does not accept. */
export function documentLanguage(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 35) return
  try { return Intl.getCanonicalLocales(value.trim())[0] } catch { return }
}

export type PageSize = 'letter' | 'a4'
export type Orientation = 'portrait' | 'landscape'
export type Margins = 'narrow' | 'normal' | 'wide'
export interface PdfPageOptions { size: PageSize; orientation: Orientation; margins: Margins }
export const defaultPageOptions: PdfPageOptions = { size: 'letter', orientation: 'portrait', margins: 'normal' }

/** Page sizes in PDF points (1/72 inch). */
export const pageSizes: Record<PageSize, { width: number; height: number; label: string }> = {
  letter: { width: 612, height: 792, label: 'Letter (8.5 × 11 in)' },
  a4: { width: 595.28, height: 841.89, label: 'A4 (210 × 297 mm)' },
}
export const marginSizes: Record<Margins, { points: number; label: string }> = {
  narrow: { points: 36, label: 'Narrow (0.5 in)' },
  normal: { points: 72, label: 'Normal (1 in)' },
  wide: { points: 108, label: 'Wide (1.5 in)' },
}

export function pageDimensions(options: PdfPageOptions) {
  const size = pageSizes[options.size]
  return options.orientation === 'landscape' ? { width: size.height, height: size.width } : { width: size.width, height: size.height }
}

/** Export bounds. See docs/phase-8-pdf.md#export-limits. */
export const exportLimits = {
  characters: 4_000_000,
  blocks: 60_000,
  pages: 3000,
  images: 200,
  imageBytes: 8 * 1024 * 1024,
  totalImageBytes: 48 * 1024 * 1024,
  diagrams: 60,
  outputBytes: 128 * 1024 * 1024,
  generateTimeoutMs: 90_000,
}

export const safePdfLink = (href: string) => /^(?:https?:\/\/[^\s/]|mailto:[^\s]|tel:[^\s])/i.test(href) && href.length <= 4096

export function runText(inlines: readonly Inline[]) {
  return inlines.map(inline => 'break' in inline ? '\n' : inline.text).join('')
}

export function blockText(block: PrintBlock): string {
  switch (block.kind) {
    case 'heading': case 'paragraph': return runText(block.inlines)
    case 'list': return block.items.map(item => item.blocks.map(blockText).join('\n')).join('\n')
    case 'quote': return [block.label ?? '', ...block.blocks.map(blockText)].join('\n')
    case 'code': case 'literal': return block.text
    case 'table': return block.rows.map(row => row.map(cell => runText(cell.inlines)).join(' ')).join('\n')
    case 'image': return block.caption ?? ''
    case 'rule': return ''
  }
}
