import { Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import type { Nodes } from 'mdast'
import { replacementText, type MatchRange, type TextMatch } from '../core/search'
import { isEmptyParagraph, markdownProcessor, writeMarkdown, type MarkdownSession } from '../document/markdown'
import { validateSource } from './sourceDiagnostics'

export type SearchScope = 'rendered' | 'source'
interface Span { visual: number; source: number; length: number }
interface SearchBlock { from: number; source: MatchRange; node: ProseMirrorNode; spans: Span[] }
interface TextPart extends MatchRange { marks: readonly Mark[] }
interface Segment { text: string; from: number; block: number; parts: TextPart[] }

interface SearchIdentity {
  id: string
  revision: number
  canReplace: boolean
}

interface MarkdownSearchDocument extends SearchIdentity {
  format: 'markdown'
  session: MarkdownSession
  blocks: SearchBlock[]
  segments: Segment[]
}

interface TextSearchDocument extends SearchIdentity {
  format: 'txt'
  source: string
}

export type SearchDocument = MarkdownSearchDocument | TextSearchDocument

export function searchSource(document: SearchDocument) {
  return document.format === 'txt' ? document.source : document.session.source
}

export interface SearchHit {
  match: TextMatch
  source: MatchRange[]
  visual: (MatchRange & { block: number })[]
  block?: number
  marks?: readonly Mark[]
}

function sourceTokens(node: Nodes, source: string, tokens: { text: string; from?: number }[]) {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
    const { value } = node
    let from = node.position?.start.offset
    const end = node.position?.end.offset
    if (from !== undefined && end !== undefined && node.type === 'code' && /^\s*(`{3,}|~{3,})/.test(source.slice(from, end))) {
      const headerEnd = source.indexOf('\n', from)
      from = headerEnd >= from && headerEnd < end ? headerEnd + 1 : undefined
    }
    const raw = from !== undefined && end !== undefined ? source.slice(from, end) : ''
    const index = raw.indexOf(value)
    tokens.push({ text: value, from: from !== undefined && index >= 0 && index === raw.lastIndexOf(value) ? from + index : undefined })
  } else if ('children' in node) {
    for (const child of node.children) sourceTokens(child, source, tokens)
  }
}

function blockSegments(node: ProseMirrorNode, from: number, block: number) {
  const segments: Segment[] = []
  function visit(item: ProseMirrorNode, start: number) {
    if (!item.isTextblock) return false
    let segment: Segment | undefined
    item.forEach((child, offset) => {
      if (!child.text) { segment = undefined; return }
      const position = start + 1 + offset
      if (!segment) {
        segment = { from: position, block, text: '', parts: [] }
        segments.push(segment)
      }
      segment.parts.push({ from: position, to: position + child.text.length, marks: child.marks })
      segment.text += child.text
    })
    return true
  }
  if (!visit(node, from)) node.descendants((child, position) => visit(child, from + position + 1) ? false : undefined)
  return segments
}

function mapSpans(tokens: { text: string; from?: number }[], segments: Segment[]): Span[] {
  if (tokens.map(token => token.text).join('') !== segments.map(segment => segment.text).join('')) return []
  const spans: Span[] = []
  let tokenIndex = 0
  let offset = 0
  for (const segment of segments) {
    let consumed = 0
    while (consumed < segment.text.length && tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]
      const length = Math.min(segment.text.length - consumed, token.text.length - offset)
      if (length && token.from !== undefined) spans.push({ visual: segment.from + consumed, source: token.from + offset, length })
      consumed += length
      offset += length
      if (offset === token.text.length) { tokenIndex++; offset = 0 }
    }
  }
  return spans
}

export function searchDocument(id: string, revision: number, session: MarkdownSession, canReplace = true): MarkdownSearchDocument {
  const blocks: SearchBlock[] = []
  const segments: Segment[] = []
  const tokens = markdownProcessor.parse(session.source).children
  let cursor = 0
  session.document.forEach((node, from, index) => {
    const original = session.blocks[index]
    if (!original) return
    while (cursor < tokens.length && (tokens[cursor].position?.start.offset ?? -1) < original.start) cursor++
    const token = tokens[cursor]
    const block = blocks.length
    const local = blockSegments(node, from, block)
    const leaves: { text: string; from?: number }[] = []
    const tokenStart = token?.position?.start.offset
    if (tokenStart !== undefined && tokenStart < original.end && !session.source.slice(original.start, tokenStart).trim()) {
      sourceTokens(token, session.source, leaves)
    }
    blocks.push({ from, source: { from: original.start, to: original.end }, node, spans: mapSpans(leaves, local) })
    for (const segment of local) segments.push(segment)
  })
  return { format: 'markdown', id, revision, canReplace, session, blocks, segments }
}

function mappedRanges(spans: Span[], range: MatchRange, from: 'visual' | 'source') {
  const to = from === 'visual' ? 'source' : 'visual'
  const ranges: MatchRange[] = []
  for (const span of spans) {
    const start = Math.max(range.from, span[from])
    const end = Math.min(range.to, span[from] + span.length)
    if (start >= end) continue
    const next = { from: span[to] + start - span[from], to: span[to] + end - span[from] }
    const last = ranges.at(-1)
    if (last?.to === next.from) last.to = next.to
    else ranges.push(next)
  }
  return ranges
}

function firstSourceBlockEndingAfter(blocks: SearchBlock[], position: number) {
  let low = 0
  let high = blocks.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (blocks[mid].source.to <= position) low = mid + 1
    else high = mid
  }
  return low
}

export function searchTexts(document: SearchDocument, scope: SearchScope) {
  if (document.format === 'txt') return [document.source]
  return scope === 'source' ? [document.session.source] : document.segments.map(segment => segment.text)
}

export function locateSearchHits(document: SearchDocument, scope: SearchScope, matches: TextMatch[]): SearchHit[] {
  return matches.map(match => {
    if (document.format === 'txt') return { match, source: [{ from: match.from, to: match.to }], visual: [] }
    if (scope === 'source') {
      const start = firstSourceBlockEndingAfter(document.blocks, match.from)
      const visual: SearchHit['visual'] = []
      for (let block = start; document.blocks[block]?.source.from < match.to; block++) {
        for (const range of mappedRanges(document.blocks[block].spans, match, 'source')) visual.push({ ...range, block })
      }
      return { match, block: visual[0]?.block, source: [{ from: match.from, to: match.to }], visual }
    }
    const segment = document.segments[match.segment]
    const visual = { from: segment.from + match.from, to: segment.from + match.to, block: segment.block }
    const parts = segment.parts.filter(part => part.to > visual.from && part.from < visual.to)
    const marks = parts[0]?.marks
    return { match, block: segment.block, visual: [visual], source: mappedRanges(document.blocks[segment.block].spans, visual, 'visual'),
      marks: marks && parts.every(part => Mark.sameSet(part.marks, marks)) ? marks : undefined }
  })
}

export function searchVisualOffsets(document: MarkdownSearchDocument, actual: ProseMirrorNode) {
  const offsets = new Map<number, number>()
  const indexed = document.blocks.map((block, index) => ({ ...block, index })).filter(block => !isEmptyParagraph(block.node))
  let index = 0
  actual.forEach((node, offset) => {
    if (isEmptyParagraph(node)) return
    const block = indexed[index++]
    if (block && block.node.type === node.type && block.node.content.size === node.content.size && block.node.textContent === node.textContent) {
      offsets.set(block.index, offset - block.from)
    }
  })
  if (index !== indexed.length) offsets.clear()
  return offsets
}

const protectedSyntax = new Set(['yaml', 'code', 'inlineCode', 'math', 'inlineMath', 'html', 'heading', 'strong', 'emphasis', 'delete',
  'link', 'linkReference', 'image', 'imageReference', 'definition', 'footnoteDefinition', 'footnoteReference', 'containerDirective', 'leafDirective', 'textDirective', 'list', 'table'])

function syntaxSignature(source: string) {
  const signature: string[] = []
  function visit(node: Nodes) {
    const tracked = protectedSyntax.has(node.type)
    if (tracked) signature.push(node.type)
    if ('children' in node) node.children.forEach(visit)
    if (tracked) signature.push('/' + node.type)
  }
  visit(markdownProcessor.parse(source))
  return signature.join(' ')
}

export function applyRenderedHits(change: Transform, hits: SearchHit[], value: string, regex: boolean, offsets?: Map<number, number>) {
  let skipped = 0
  let replaced = 0
  for (const hit of [...hits].reverse()) {
    const text = replacementText(value, hit.match, regex).replace(/\r\n?/g, '\n')
    if (text === hit.match.text) continue
    if (!hit.marks) { skipped++; continue }
    const range = hit.visual[0]
    const offset = offsets ? offsets.get(range.block) : 0
    if (offset === undefined) throw new Error('The visual editor is still updating. Try the replacement again.')
    const from = range.from + offset
    const to = range.to + offset
    let marks = hit.marks
    if (offsets) {
      const start = change.doc.resolve(from)
      const end = change.doc.resolve(to)
      if (start.parent !== end.parent || change.doc.textBetween(from, to, '', '\uFFFC') !== hit.match.text) {
        throw new Error('The visual match changed. Try the replacement again.')
      }
      const live: (readonly Mark[])[] = []
      change.doc.nodesBetween(from, to, node => { if (node.isText) live.push(node.marks) })
      if (!live.length || live.some(set => !Mark.sameSet(live[0], set))) throw new Error('The visual match spans multiple formats.')
      marks = live[0]
    }
    if (text) change.replaceWith(from, to, change.doc.type.schema.text(text, marks))
    else change.delete(from, to)
    replaced++
  }
  return { skipped, replaced }
}

export function replaceSearchHits(document: SearchDocument, scope: SearchScope, hits: SearchHit[], value: string, regex: boolean) {
  if (!document.canReplace) throw new Error('Finish the Markdown structure or use Raw Markdown to replace text in this draft.')
  const original = searchSource(document)
  let source = original
  let skipped = 0
  let replaced = 0
  if (document.format === 'txt' || scope === 'source') {
    const pieces: string[] = []
    let from = 0
    for (const { match } of hits) {
      const text = replacementText(value, match, regex).replace(/\r\n?/g, '\n')
      pieces.push(source.slice(from, match.from), text)
      from = match.to
      if (text !== match.text) replaced++
    }
    source = pieces.join('') + source.slice(from)
    if (document.format === 'markdown' && replaced) {
      const before = validateSource(original)
      const after = validateSource(source)
      const newIssue = after.find(item => !before.some(previous => previous.message === item.message))
      if (newIssue) throw new Error('The replacement would leave invalid Markdown. ' + newIssue.message)
      if (after.length >= before.length && syntaxSignature(original) !== syntaxSignature(source)) {
        throw new Error('The replacement would change Markdown structure. Edit the syntax directly in Markdown Source.')
      }
    }
  } else {
    const change = new Transform(document.session.document)
    const counts = applyRenderedHits(change, hits, value, regex)
    replaced = counts.replaced
    skipped = counts.skipped
    if (replaced) source = writeMarkdown(document.session, change.doc).source
  }
  return { source, replaced, skipped }
}
