import { type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/core'
import type { Root } from 'mdast'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import { calloutKinds, safeUrl, type CalloutKind } from '../editor/schema'
import { htmlMarkTags, isLegacyBlock, normalizeStyleMarks, readBlockHtml, readInlineImage, readInlineOpening, writeHtml } from './markdownHtml'

export const markdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter).use(remarkMath).use(remarkDirective).use(remarkStringify, {
  bullet: '-', rule: '-', emphasis: '*', strong: '*', fences: true, listItemIndent: 'one',
})

type Mark = NonNullable<JSONContent['marks']>[number]
interface MarkdownNode {
  type: string
  children?: MarkdownNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
  value?: string
  depth?: number
  lang?: string | null
  meta?: string | null
  url?: string
  title?: string | null
  alt?: string | null
  ordered?: boolean
  start?: number
  checked?: boolean | null
  align?: (string | null)[]
}

interface SourceBlock {
  id: string
  start: number
  end: number
  raw: string
  node: ProseMirrorNode
}

export interface MarkdownSession {
  source: string
  document: ProseMirrorNode
  blocks: SourceBlock[]
  frontMatter?: { start: number; end: number; value: string }
  referenceSource: string
  warnings: number
}

const boundary = '<!--folio:boundary-->'
const boundaryProbe = 'Folio boundary probe.'
const rangeOf = (node: MarkdownNode) => ({ start: node.position?.start.offset ?? 0, end: node.position?.end.offset ?? 0 })
const slice = (node: MarkdownNode, source: string) => { const { start, end } = rangeOf(node); return source.slice(start, end) }
function blockRange(node: MarkdownNode, source: string) {
  const range = rangeOf(node)
  const lineStart = range.start === 0 ? 0 : source.lastIndexOf('\n', range.start - 1) + 1
  return /^[\t ]*$/.test(source.slice(lineStart, range.start)) ? { ...range, start: lineStart } : range
}
const textNode = (text: string, marks: Mark[] = []): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const paragraph = (content: JSONContent[] = []): JSONContent => ({ type: 'paragraph', content })
const childrenOf = (node: MarkdownNode) => node.children ?? []
const rawNode = (node: MarkdownNode, source: string, inline = false): JSONContent => {
  const value = slice(node, source)
  return { type: inline ? 'rawInline' : 'rawBlock', attrs: { value, label: inline ? value : null } }
}

function wikiText(value: string, marks: Mark[]): JSONContent[] {
  const matches = value.matchAll(/\[\[([^\]\n]+)\]\]/g)
  const result: JSONContent[] = []
  let offset = 0
  for (const match of matches) {
    if (match.index > offset) result.push(textNode(value.slice(offset, match.index), marks))
    const [target, label] = match[1].split('|', 2)
    result.push({ type: 'wikiLink', attrs: { value: match[1], label: label || target }, marks })
    offset = match.index + match[0].length
  }
  if (offset < value.length) result.push(textNode(value.slice(offset), marks))
  return result
}

function mergeInlineMarks(inherited: Mark[], incoming: Mark[]): Mark[] {
  const types = new Set(incoming.map(mark => mark.type))
  return [
    ...inherited.filter(mark => !types.has(mark.type)),
    ...incoming.map(mark => {
      if (mark.type !== 'textStyle') return mark
      const outer = inherited.find(item => item.type === 'textStyle')
      if (!outer) return mark
      const declared = Object.fromEntries(Object.entries(mark.attrs ?? {}).filter(([, value]) => value != null && value !== ''))
      return { ...mark, attrs: { ...outer.attrs, ...declared } }
    }),
  ]
}

function inlineNodes(nodes: MarkdownNode[], source: string, schema: Schema, marks: Mark[] = []): JSONContent[] {
  const pairs = new Map<number, { end: number; marks: Mark[] }>()
  const stack: { index: number; tag: string; marks?: Mark[] }[] = []
  nodes.forEach((node, index) => {
    if (node.type !== 'html' || !node.value) return
    const raw = node.value.trim()
    const top = stack.at(-1)
    if (raw.startsWith('</')) {
      if (top && raw.toLowerCase().replace(/\s/g, '') === '</' + top.tag + '>') {
        stack.pop()
        if (top.marks) pairs.set(top.index, { end: index, marks: top.marks })
      }
      return
    }
    const opening = readInlineOpening(raw, schema)
    if (opening) stack.push({ index, tag: opening.tag, marks: opening.marks?.map(mark => mark.toJSON()) })
  })

  function render(node: MarkdownNode, marks: Mark[]): JSONContent[] {
    const value = node.value ?? ''
    switch (node.type) {
      case 'text': return slice(node, source).includes('[[') ? wikiText(value, marks) : value ? [textNode(value, marks)] : []
      case 'strong': return inlineNodes(childrenOf(node), source, schema, mergeInlineMarks(marks, [{ type: 'bold' }]))
      case 'emphasis': return inlineNodes(childrenOf(node), source, schema, mergeInlineMarks(marks, [{ type: 'italic' }]))
      case 'delete': return inlineNodes(childrenOf(node), source, schema, mergeInlineMarks(marks, [{ type: 'strike' }]))
      case 'inlineCode': return value ? [textNode(value, mergeInlineMarks(marks, [{ type: 'code' }]))] : []
      case 'inlineMath': return [{ type: 'inlineMath', attrs: { value }, marks }]
      case 'break': return [{ type: 'hardBreak', marks }]
      case 'link':
        return safeUrl(node.url ?? '')
          ? inlineNodes(childrenOf(node), source, schema, mergeInlineMarks(marks, [{ type: 'link', attrs: { href: node.url, title: node.title } }]))
          : [{ ...rawNode(node, source, true), marks }]
      case 'image':
        return safeUrl(node.url ?? '', true)
          ? [{ type: 'image', attrs: { src: node.url, alt: node.alt ?? '', title: node.title }, marks }]
          : [{ ...rawNode(node, source, true), marks }]
      case 'html': {
        const image = readInlineImage(value, schema)
        return [{ ...(image?.toJSON() ?? rawNode(node, source, true)), marks }]
      }
      default: return [{ ...rawNode(node, source, true), marks }]
    }
  }
  function range(from: number, to: number, inherited: Mark[]): JSONContent[] {
    const result: JSONContent[] = []
    for (let index = from; index < to; index++) {
      const pair = pairs.get(index)
      if (!pair || pair.end >= to || pair.end === index + 1) {
        result.push(...render(nodes[index], inherited))
        continue
      }
      result.push(...range(index + 1, pair.end, mergeInlineMarks(inherited, pair.marks)))
      index = pair.end
    }
    return result
  }
  return range(0, nodes.length, marks)
}

function readQuote(node: MarkdownNode, source: string, schema: Schema): JSONContent {
  const children = childrenOf(node)
  const first = children[0]
  const prefix = first?.type === 'paragraph' && first.children?.[0]?.type === 'text' ? first.children[0] : undefined
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\](?:\n|$)/i.exec(prefix?.value ?? '')
  if (!prefix || !match) return { type: 'blockquote', content: children.map(child => readBlock(child, source, schema)) }
  const remainder = (prefix.value ?? '').slice(match[0].length)
  const inline = [...(remainder ? [{ ...prefix, value: remainder }] : []), ...childrenOf(first).slice(1)]
  const content = [...(inline.length ? [paragraph(inlineNodes(inline, source, schema))] : []), ...children.slice(1).map(child => readBlock(child, source, schema))]
  return { type: 'callout', attrs: { kind: match[1].toLowerCase() }, content: content.length ? content : [paragraph()] }
}

function readList(node: MarkdownNode, source: string, schema: Schema): JSONContent {
  const items = childrenOf(node)
  const task = !node.ordered && items.length > 0 && items.every(item => typeof item.checked === 'boolean')
  if (!task && items.some(item => typeof item.checked === 'boolean')) return rawNode(node, source)
  return {
    type: task ? 'taskList' : node.ordered ? 'orderedList' : 'bulletList',
    ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
    content: items.map(item => {
      const content = childrenOf(item).map(child => readBlock(child, source, schema))
      if (content[0]?.type !== 'paragraph') content.unshift(paragraph())
      return { type: task ? 'taskItem' : 'listItem', ...(task ? { attrs: { checked: item.checked } } : {}), content }
    }),
  }
}

function readBlock(node: MarkdownNode, source: string, schema: Schema): JSONContent {
  const inline = () => inlineNodes(childrenOf(node), source, schema)
  switch (node.type) {
    case 'paragraph': {
      const raw = slice(node, source)
      if (/^\[(?:\[toc\]|toc)\]$/i.test(raw)) return { type: 'toc' }
      if (/^(?:::{1,}|{%|{{)/.test(raw)) return rawNode(node, source)
      return paragraph(inline())
    }
    case 'heading': return { type: 'heading', attrs: { level: node.depth ?? 1 }, content: inline() }
    case 'thematicBreak': return { type: 'horizontalRule' }
    case 'blockquote': return readQuote(node, source, schema)
    case 'list': return readList(node, source, schema)
    case 'table': return {
      type: 'table',
      content: childrenOf(node).map((row, rowIndex) => ({
        type: 'tableRow',
        content: childrenOf(row).map((cell, column) => ({
          type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          attrs: { cellAlign: node.align?.[column] ?? null },
          content: [paragraph(inlineNodes(childrenOf(cell), source, schema))],
        })),
      })),
    }
    case 'math': return { type: 'blockMath', attrs: { value: node.value ?? '', meta: node.meta } }
    case 'code': return node.lang?.toLowerCase() === 'mermaid'
      ? { type: 'mermaid', attrs: { value: node.value ?? '', meta: node.meta } }
      : { type: 'codeBlock', attrs: { language: node.lang ?? null, meta: node.meta }, content: node.value ? [textNode(node.value)] : [] }
    case 'html': return readBlockHtml(slice(node, source), schema)?.toJSON() ?? rawNode(node, source)
    default: return rawNode(node, source)
  }
}

function parse(source: string): MarkdownNode[] {
  return (markdownProcessor.parse(source) as MarkdownNode).children ?? []
}

function checkedBlock(node: MarkdownNode, source: string, schema: Schema, id: string | null): ProseMirrorNode {
  try {
    const json = readBlock(node, source, schema)
    const result = schema.nodeFromJSON({ ...json, attrs: { ...json.attrs, sourceId: id } })
    result.check()
    return result
  } catch {
    const json = rawNode(node, source)
    return schema.nodeFromJSON({ ...json, attrs: { ...json.attrs, sourceId: id } })
  }
}

let nextSourceId = 0

export function openMarkdown(source: string, schema: Schema): MarkdownSession {
  const blocks: SourceBlock[] = []
  const references: string[] = []
  let frontMatter: MarkdownSession['frontMatter']
  for (const node of parse(source)) {
    const range = blockRange(node, source)
    const raw = source.slice(range.start, range.end)
    if (node.type === 'yaml') {
      frontMatter = { ...range, value: node.value ?? '' }
      continue
    }
    if (raw === boundary) continue
    if (node.type === 'definition' || node.type === 'footnoteDefinition') references.push(raw)
    const id = String(++nextSourceId)
    blocks.push({ ...range, id, raw, node: checkedBlock(node, source, schema, id) })
  }
  const doc = schema.topNodeType.createAndFill({ frontMatter: frontMatter?.value ?? '' }, blocks.map(block => block.node))
  if (!doc) throw new Error('This document could not be opened in the visual editor.')
  let warnings = 0
  doc.descendants(node => { if (node.type.name === 'rawBlock' || node.type.name === 'rawInline') warnings++ })
  return { source, blocks, document: doc, frontMatter, referenceSource: references.join('\n\n'), warnings }
}

export function rebaseMarkdown(session: MarkdownSession, previous: ProseMirrorNode): MarkdownSession {
  if (!session.blocks.length) return session
  const blocks = [...session.blocks]
  function reuse(index: number, oldIndex: number) {
    const block = blocks[index]
    const old = previous.child(oldIndex)
    if (old.type !== block.node.type || !old.content.eq(block.node.content)) return false
    const candidate = block.node.type.create({ ...block.node.attrs, sourceId: old.attrs.sourceId }, block.node.content, block.node.marks)
    if (!old.eq(candidate)) return false
    blocks[index] = { ...block, id: old.attrs.sourceId ?? block.id, node: old }
    return true
  }
  let prefix = 0
  const overlap = Math.min(blocks.length, previous.childCount)
  while (prefix < overlap && reuse(prefix, prefix)) prefix++
  let suffix = 0
  while (prefix + suffix < overlap && reuse(blocks.length - suffix - 1, previous.childCount - suffix - 1)) suffix++
  // Match edited blocks between unchanged neighbors when their positions still line up.
  if (blocks.length === previous.childCount) {
    for (let index = prefix; index < blocks.length - suffix; index++) {
      const block = blocks[index]
      const old = previous.child(index)
      if (old.type !== block.node.type) continue
      const id = old.attrs.sourceId as string | null
      const node = block.node.type.create({ ...block.node.attrs, sourceId: id }, block.node.content, block.node.marks)
      blocks[index] = { ...block, id: id ?? block.id, node }
    }
  }
  return { ...session, blocks, document: session.document.type.create(session.document.attrs, blocks.map(block => block.node)) }
}

function needsBlockHtml(node: ProseMirrorNode): boolean {
  const { textAlign, displayStyle, lineSpacing, paragraphSpacing, indent, caption, align, colspan, rowspan, colwidth } = node.attrs
  return Boolean((textAlign && textAlign !== 'left') || displayStyle || lineSpacing || paragraphSpacing || indent || caption || align || colspan > 1 || rowspan > 1 || colwidth)
    || node.children.some(needsBlockHtml)
}

function inlineMarkdown(nodes: readonly ProseMirrorNode[], htmlMarks: boolean): MarkdownNode[] {
  const root: MarkdownNode[] = []
  const active: { mark: ProseMirrorNode['marks'][number]; children: MarkdownNode[]; close?: string }[] = []
  const output = () => active.at(-1)?.children ?? root
  const closeUntil = (length: number) => {
    while (active.length > length) {
      const entry = active.pop()
      if (entry?.close) output().push({ type: 'html', value: entry.close })
    }
  }
  for (const node of nodes) {
    const code = !htmlMarks ? node.marks.find(mark => mark.type.name === 'code') : undefined
    const wrapping = node.marks.filter(mark => mark !== code)
    let common = 0
    while (common < active.length && common < wrapping.length && active[common].mark.eq(wrapping[common])) common++
    closeUntil(common)
    for (const mark of wrapping.slice(common)) {
      const type = ({ bold: 'strong', italic: 'emphasis', strike: 'delete', link: 'link' })[mark.type.name]
      const children: MarkdownNode[] = []
      if (type && !htmlMarks) {
        output().push({ type, children, ...(type === 'link' ? { url: mark.attrs.href, title: mark.attrs.title ?? null } : {}) })
        active.push({ mark, children })
      } else {
        const tags = htmlMarkTags(mark)
        if (!tags) continue
        output().push({ type: 'html', value: tags[0] })
        active.push({ mark, children: output(), close: tags[1] })
      }
    }
    let token: MarkdownNode
    switch (node.type.name) {
      case 'image': token = node.attrs.width || node.attrs.title === '' ? { type: 'html', value: writeHtml(node) }
        : { type: 'image', url: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }; break
      case 'inlineMath': token = { type: 'inlineMath', value: node.attrs.value }; break
      case 'wikiLink': token = { type: 'html', value: '[[' + node.attrs.value + ']]' }; break
      case 'rawInline': token = { type: 'html', value: node.attrs.value }; break
      case 'hardBreak': token = { type: 'break' }; break
      default: token = { type: code ? 'inlineCode' : 'text', value: node.text ?? '' }
    }
    output().push(token)
  }
  closeUntil(0)
  return root
}

function portableTable(node: ProseMirrorNode, htmlMarks: boolean): MarkdownNode | undefined {
  if (needsBlockHtml(node) || !node.firstChild?.children.every(cell => cell.type.name === 'tableHeader')) return undefined
  const align = node.firstChild.children.map(cell => cell.attrs.cellAlign ?? null)
  const rows: MarkdownNode[] = []
  for (const [rowIndex, row] of node.children.entries()) {
    if (row.childCount !== align.length) return undefined
    const cells: MarkdownNode[] = []
    for (const [column, cell] of row.children.entries()) {
      if (rowIndex > 0 && cell.type.name !== 'tableCell') return undefined
      if (cell.childCount !== 1 || cell.firstChild?.type.name !== 'paragraph' || cell.attrs.cellAlign !== align[column]) return undefined
      const content = cell.firstChild.children
      if (content.some(child => child.type.name === 'hardBreak' || child.text?.includes('\n'))) return undefined
      cells.push({ type: 'tableCell', children: inlineMarkdown(content, htmlMarks) })
    }
    rows.push({ type: 'tableRow', children: cells })
  }
  return { type: 'table', align, children: rows }
}

function portableBlock(node: ProseMirrorNode, htmlMarks: boolean): MarkdownNode | undefined {
  if ((node.type.name === 'paragraph' || node.type.name === 'heading') && needsBlockHtml(node)) {
    return { type: 'html', value: writeHtml(node) }
  }
  const inline = () => inlineMarkdown(node.children, htmlMarks)
  const blocks = (): MarkdownNode[] | undefined => {
    const children = node.children.map(child => portableBlock(child, htmlMarks))
    return children.every(child => child !== undefined) ? children : undefined
  }
  switch (node.type.name) {
    case 'paragraph': return node.childCount ? { type: 'paragraph', children: inline() } : undefined
    case 'heading': return { type: 'heading', depth: node.attrs.level, children: inline() }
    case 'blockquote': {
      const children = blocks()
      return children && { type: 'blockquote', children }
    }
    case 'callout': {
      const kind = node.attrs.kind as CalloutKind
      if (!calloutKinds.includes(kind)) return undefined
      const children = blocks() ?? (node.childCount === 1 && node.firstChild?.type.name === 'paragraph' && !node.firstChild.childCount ? [] : undefined)
      if (!children) return undefined
      const marker = { type: 'html', value: '[!' + kind.toUpperCase() + ']' }
      const first = children[0]
      if (first?.type === 'paragraph') first.children?.unshift({ ...marker, value: marker.value + '\n' })
      else children.unshift({ type: 'paragraph', children: [marker] })
      return { type: 'blockquote', children }
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const children = blocks()
      return children && { type: 'list', ordered: node.type.name === 'orderedList', start: node.attrs.start, children }
    }
    case 'listItem':
    case 'taskItem': {
      const children = node.children.map((child, index) => index === 0 && isEmptyParagraph(child)
        ? { type: 'paragraph', children: [] } : portableBlock(child, htmlMarks))
      return children.every(child => child !== undefined) ? { type: 'listItem', checked: node.attrs.checked ?? null, children } : undefined
    }
    case 'table': return portableTable(node, htmlMarks)
    case 'horizontalRule': return { type: 'thematicBreak' }
    case 'codeBlock': return { type: 'code', value: node.textContent, lang: node.attrs.language, meta: node.attrs.meta }
    case 'mermaid': return { type: 'code', value: node.attrs.value, lang: 'mermaid', meta: node.attrs.meta }
    case 'blockMath': return { type: 'math', value: node.attrs.value, meta: node.attrs.meta }
    case 'toc': return { type: 'html', value: '[[TOC]]' }
    case 'rawBlock': return { type: 'html', value: node.attrs.value }
    default: return undefined
  }
}

function withoutIdentity(node: ProseMirrorNode): unknown {
  const { sourceId: _sourceId, ...attrs } = node.attrs
  const layoutAttrs = attrs.textAlign === 'left' ? { ...attrs, textAlign: null } : attrs
  return { type: node.type.name, attrs: layoutAttrs, text: node.text, marks: node.marks.map(normalizeStyleMarks), children: node.children.map(withoutIdentity) }
}

function matchesSourceBlock(previous: ProseMirrorNode, node: ProseMirrorNode): boolean {
  if (previous.eq(node)) return true
  // Explicitly choosing the default must preserve existing Markdown spelling.
  return previous.attrs.textAlign === null && node.attrs.textAlign === 'left'
    && node.type.create({ ...node.attrs, textAlign: null }, node.content, node.marks).eq(previous)
}

function tryTextPatch(block: SourceBlock, node: ProseMirrorNode, references: string): string | undefined {
  if (node.type !== block.node.type || node.childCount !== block.node.childCount || (node.type.name !== 'paragraph' && node.type.name !== 'heading')) return undefined
  if (isLegacyBlock(block.raw) || (block.node.attrs.textAlign === 'left' && !needsBlockHtml(node))) return undefined
  const differences = block.node.children.map((before, index) => ({ before, after: node.child(index) })).filter(({ before, after }) => !before.eq(after))
  if (differences.length !== 1) return undefined
  const [{ before, after }] = differences
  if (!before.text || !after.text || !before.sameMarkup(after)) return undefined
  const index = block.raw.indexOf(before.text)
  if (index < 0 || index !== block.raw.lastIndexOf(before.text)) return undefined
  const updated = block.raw.slice(0, index) + after.text + block.raw.slice(index + before.text.length)
  return equivalent(updated, node, references) ? updated : undefined
}

function tryImagePatch(block: SourceBlock, node: ProseMirrorNode, references: string): string | undefined {
  if (!block.node.sameMarkup(node) || isLegacyBlock(block.raw) ||
    (block.node.attrs.textAlign === 'left' && !needsBlockHtml(node))) return
  const before = block.node.content
  const from = before.findDiffStart(node.content)
  const end = before.findDiffEnd(node.content)
  if (from === null || !end || end.a < from || end.b !== from + 1) return
  const image = node.nodeAt(from)
  if (!image || image.type.name !== 'image' || needsBlockHtml(image)) return
  const markdown = markdownProcessor.stringify({
    type: 'root', children: [{ type: 'paragraph', children: inlineMarkdown([image], false) }],
  } as Root).replace(/\n$/, '')
  let patched: string | undefined
  block.node.nodesBetween(Math.max(0, from - 1), Math.min(before.size, end.a + 1), (text, offset) => {
    if (patched || !text.text || from < offset || end.a > offset + text.nodeSize) return
    // Try the whole text run first so repeated words within that run keep their exact positions.
    const selected = text.text.slice(from - offset, end.a - offset)
    for (const [anchor, shift] of [[text.text, from - offset], [selected, 0]] as const) {
      if (!anchor) continue
      const index = block.raw.indexOf(anchor)
      if (index < 0 || index !== block.raw.lastIndexOf(anchor)) continue
      const start = index + shift
      const updated = block.raw.slice(0, start) + markdown + block.raw.slice(start + end.a - from)
      if (equivalent(updated, node, references)) { patched = updated; return }
    }
  })
  return patched
}

function equivalent(source: string, node: ProseMirrorNode, references: string): boolean {
  const context = references ? source + '\n\n' + references : source
  const projection = parse(context)
  const first = projection[0]
  if (!first || rangeOf(first).end !== source.length) return false
  const actual = checkedBlock(first, context, node.type.schema, null)
  return JSON.stringify(withoutIdentity(node)) === JSON.stringify(withoutIdentity(actual))
}

function writeBlock(node: ProseMirrorNode, references: string): string {
  if (node.type.name === 'rawBlock') return node.attrs.value
  for (const htmlMarks of [false, true]) {
    const ast = portableBlock(node, htmlMarks)
    if (!ast) break
    const value = markdownProcessor.stringify({ type: 'root', children: [ast] } as Root).replace(/\n$/, '')
    if (equivalent(value, node, references)) return value
  }
  for (const legacyWrapper of [false, true]) {
    const value = writeHtml(node, legacyWrapper)
    if (equivalent(value, node, references)) return value
  }
  throw new Error('A block could not be converted without changing its contents. Undo the last edit or adjust its formatting.')
}

export interface MarkdownWrite { source: string; protectedBoundaries: boolean }

function writeIsolatedText(session: MarkdownSession, document: ProseMirrorNode): string | undefined {
  const { blocks, source } = session
  if (blocks.length !== document.childCount || !document.sameMarkup(session.document)) return
  const index = blocks.findIndex((block, position) => block.node !== document.child(position))
  if (index < 0) return
  const block = blocks[index]
  const node = document.child(index)
  const before = block.node.firstChild
  const after = node.firstChild
  if (!block.node.sameMarkup(node) || block.node.childCount !== 1 || node.childCount !== 1 ||
    !before?.text || !after?.text || before.marks.length || after.marks.length) return

  const heading = node.type.name === 'heading'
  if (!heading && node.type.name !== 'paragraph') return
  // Plain words cannot introduce inline delimiters, a reference definition or a list marker.
  const plain = heading ? /^[a-z0-9]+(?: +[a-z0-9]+)*[.!?]?$/i : /^[a-z][a-z0-9]*(?: +[a-z0-9]+)*[.!?]?$/i
  if (!plain.test(before.text) || !plain.test(after.text) ||
    before.text.trim() !== before.text || after.text.trim() !== after.text) return
  const prefix = (heading ? /^ {0,3}#{1,6}[ \t]+/ : /^ {0,3}/).exec(block.raw)?.[0]
  if (prefix === undefined || !block.raw.startsWith(prefix + before.text)) return
  const suffix = block.raw.slice(prefix.length + before.text.length)
  if (!(heading ? /^(?:[ \t]+#+)?[ \t]*$/ : /^[ \t]*$/).test(suffix) || /[\r\n]/.test(suffix)) return

  // A blank line keeps the edit independent of surrounding block grammar.
  const previous = blocks[index - 1] ?? session.frontMatter
  const next = blocks[index + 1]
  if (previous && !/\r?\n[ \t]*\r?\n$/.test(source.slice(previous.end, block.start))) return
  if (next && !/^\r?\n[ \t]*\r?\n/.test(source.slice(block.end, next.start))) return
  for (let i = index + 1; i < blocks.length; i++) {
    if (blocks[i].node !== document.child(i)) return
  }
  return source.slice(0, block.start) + prefix + after.text + suffix + source.slice(block.end)
}

export function writeMarkdown(session: MarkdownSession, document: ProseMirrorNode): MarkdownWrite {
  if (document.eq(session.document)) return { source: session.source, protectedBoundaries: false }
  const localEdit = writeIsolatedText(session, document)
  if (localEdit !== undefined) return { source: localEdit, protectedBoundaries: false }
  const frontMatter: string = document.attrs.frontMatter ?? ''
  const frontChanged = frontMatter !== session.document.attrs.frontMatter
  if (frontChanged && document.content.eq(session.document.content)) {
    return { source: setFrontMatter(session, frontMatter), protectedBoundaries: false }
  }
  const original = new Map(session.blocks.map(block => [block.id, block]))
  const originalNodes = new Map(session.blocks.map(block => [block.node, block]))
  const owner = new Map<SourceBlock, ProseMirrorNode>()
  const lookup = (node: ProseMirrorNode) => originalNodes.get(node) ?? original.get(node.attrs.sourceId)
  for (const node of document.children) {
    const block = lookup(node)
    if (block && matchesSourceBlock(block.node, node) && !owner.has(block)) owner.set(block, node)
  }
  const used = new Set<SourceBlock>()
  const first = session.blocks[0]
  const last = session.blocks.at(-1)
  const originalLead = first ? session.source.slice(0, first.start) : session.source
  const lead = frontChanged ? setFrontMatter({ ...session, source: originalLead }, frontMatter) : originalLead
  const hasFrontMatter = frontChanged ? !!frontMatter.trim() : !!session.frontMatter
  const tail = last ? session.source.slice(last.end) : ''
  const newDefinitions = document.children.filter(node => node.type.name === 'rawBlock' && /^\s*\[[^\]]+\]:/.test(node.attrs.value)).map(node => node.attrs.value as string)
  const references = [...new Set([session.referenceSource, ...newDefinitions].filter(Boolean))].join('\n\n')
  const pieces = document.children.flatMap(node => {
    const assigned = lookup(node)
    const block = assigned && !used.has(assigned) && (!owner.has(assigned) || owner.get(assigned) === node) ? assigned : undefined
    if (block) used.add(block)
    const unchanged = !!block && matchesSourceBlock(block.node, node)
    if (!unchanged && isEmptyParagraph(node)) return []
    const raw = block && unchanged ? block.raw : (block && (tryTextPatch(block, node, references) ?? tryImagePatch(block, node, references))) ?? writeBlock(node, references)
    return [{ raw, node, block, unchanged }]
  })
  if (!pieces.length) return { source: hasFrontMatter ? lead : '', protectedBoundaries: false }

  const leadOffset = lead && !/\n\n$/.test(lead) && hasFrontMatter ? lead.replace(/\n*$/, '\n\n') : lead
  const firstPiece = pieces[0]
  const leading = firstPiece.block === first && firstPiece.unchanged ? lead : leadOffset
  const ending = last ? tail : '\n'
  const indices = new Map(session.blocks.map((block, index) => [block, index]))
  function assemble(mode: 'original' | 'spaced' | 'protected' | 'wrapped') {
    const protect = mode === 'protected' || mode === 'wrapped'
    let source = leading
    const rawPieces: string[] = []
    for (const [index, piece] of pieces.entries()) {
      let raw = piece.raw
      if (mode === 'wrapped' && index < pieces.length - 1) {
        const testSource = raw + '\n\n' + boundary + '\n\n' + boundaryProbe
        if (!parse(testSource).some(token => slice(token, testSource) === boundaryProbe)) {
          raw = piece.node.type.name === 'rawBlock'
            ? writeHtml(piece.node.type.create({ ...piece.node.attrs, value: raw }))
            : writeBlock(piece.node, references)
        }
      }
      if (index > 0) {
        const before = pieces[index - 1]
        const priorIndex = before.block ? indices.get(before.block) : undefined
        const nextIndex = piece.block ? indices.get(piece.block) : undefined
        if (before.block && piece.block && priorIndex !== undefined && nextIndex === priorIndex + 1
          && (mode === 'original' || (mode !== 'wrapped' && before.unchanged && piece.unchanged))) {
          source += session.source.slice(before.block.end, piece.block.start)
        } else {
          source += protect ? '\n\n' + boundary + '\n\n' : '\n\n'
        }
      }
      source += raw
      rawPieces.push(raw)
    }
    return { source: source + ending, rawPieces }
  }
  for (const mode of ['original', 'spaced', 'protected', 'wrapped'] as const) {
    const assembled = assemble(mode)
    const rawPieces = assembled.rawPieces
    let source = assembled.source
    let parsed = parse(source)
    // A rule on the first line can look like opening YAML followed by a later rule.
    if (!hasFrontMatter && parsed[0]?.type === 'yaml' && rawPieces[0].trim() === '---') {
      source = '\n' + source
      parsed = parse(source)
    }
    const projection = parsed.filter(node => node.type !== 'yaml' && slice(node, source) !== boundary)
    if (projection.length === pieces.length && projection.every((node, index) => {
      const { start, end } = blockRange(node, source)
      return source.slice(start, end) === rawPieces[index]
    })) return { source, protectedBoundaries: mode === 'protected' || mode === 'wrapped' }
  }
  throw new Error('This arrangement could not be converted safely. Move the preserved blocks or undo the last edit.')
}

export function isEmptyParagraph(node: ProseMirrorNode) {
  return node.type.name === 'paragraph' && node.childCount === 0 && !needsBlockHtml(node)
}

export function setFrontMatter(session: MarkdownSession, value: string): string {
  const yaml = value.trim() ? '---\n' + value.replace(/\n$/, '') + '\n---' : ''
  const front = session.frontMatter
  return front ? session.source.slice(0, front.start) + yaml + session.source.slice(front.end) : yaml ? yaml + '\n\n' + session.source : session.source
}
