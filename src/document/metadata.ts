import { isMap, isScalar, parseDocument } from 'yaml'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { headingSlug } from './headingSlug'

export { headingSlug } from './headingSlug'

export function readMetadata(source: string) {
  const document = parseDocument(source, { keepSourceTokens: true })
  const error = document.errors[0]?.message ?? (document.contents && !isMap(document.contents) ? 'Front matter must be a YAML mapping.' : null)
  const fields = new Map<string, unknown>()
  if (!error && isMap(document.contents)) {
    for (const item of document.contents.items) {
      if (isScalar(item.key) && typeof item.key.value === 'string') fields.set(item.key.value, document.get(item.key.value))
    }
  }
  return { document, error, fields }
}

export function updateMetadata(source: string, key: string, value: string | string[] | undefined) {
  const { document, error } = readMetadata(source)
  if (error) throw new Error(error)
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) document.delete(key)
  else document.set(key, value)
  return document.contents ? document.toString({ lineWidth: 0 }).replace(/\n$/, '') : ''
}

export interface Heading { title: string; level: number; anchor: string; position: number }
export interface Statistics { words: number; characters: number; compact: number; minutes: number; headings: number; links: number; images: number }

function wordStatistics(text: string) {
  let words = 0
  for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) if (part.isWordLike) words++
  return { words, minutes: words ? Math.ceil(words / 225) : 0 }
}

export function plainDocumentInfo(text: string) {
  const whitespace = /\s/u
  let characters = 0
  let compact = 0
  for (const character of text) {
    characters++
    if (!whitespace.test(character)) compact++
  }
  return { outline: [] as Heading[], statistics: { ...wordStatistics(text), characters, compact, headings: 0, links: 0, images: 0 } }
}

export function documentInfo(doc: ProseMirrorNode) {
  const outline: Heading[] = []
  const anchors = new Set<string>()
  let images = 0
  let links = 0
  let previousLink: string | undefined
  doc.descendants((node, position) => {
    if (node.type.name === 'heading') {
      const title = node.textContent.trim() || 'Untitled heading'
      const slug = headingSlug(title)
      let anchor = slug
      for (let suffix = 2; anchors.has(anchor); suffix++) anchor = slug + '-' + suffix
      anchors.add(anchor)
      outline.push({ title, level: node.attrs.level, anchor, position })
    }
    if (node.type.name === 'image') images++
    const link = node.marks.find(mark => mark.type.name === 'link')?.attrs.href
    if (link && link !== previousLink) links++
    if (node.type.name === 'wikiLink' || (node.type.name === 'rawInline' && /^\[(?!\^)/.test(node.attrs.value))) links++
    previousLink = link
  })
  const text = doc.textBetween(0, doc.content.size, '\n', node => {
    if (node.type.name === 'image') return node.attrs.alt ?? ''
    if (node.type.name === 'inlineMath' || node.type.name === 'wikiLink') return node.attrs.label || node.attrs.value
    if (node.type.name === 'rawInline' && /^\[(?!\^)/.test(node.attrs.value)) return /^\[([^\]]*)\]/.exec(node.attrs.value)?.[1] ?? ''
    return ''
  })
  const statistics: Statistics = { ...wordStatistics(text), characters: Array.from(text).length, compact: Array.from(text.replace(/\s/gu, '')).length, headings: outline.length, links, images }
  return { outline, statistics }
}
