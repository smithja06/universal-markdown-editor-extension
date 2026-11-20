import { Extension, Node, mergeAttributes, type Attributes, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Code from '@tiptap/extension-code'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { TextStyleKit } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import Placeholder from '@tiptap/extension-placeholder'

export const calloutKinds = ['note', 'tip', 'important', 'warning', 'caution', 'info'] as const
export type CalloutKind = typeof calloutKinds[number]

export function safeUrl(value: string, image = false): boolean {
  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
  if (!compact) return false
  if (image && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,[a-z\d+/=]+$/i.test(compact)) return true
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(compact)?.[1].toLowerCase()
  return !protocol || (image ? ['http', 'https'] : ['http', 'https', 'mailto', 'tel']).includes(protocol)
}

const sourceNodes = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'horizontalRule', 'codeBlock', 'table', 'rawBlock', 'callout', 'mermaid', 'blockMath', 'toc']
const SourceIdentity = Extension.create({
  name: 'sourceIdentity',
  addGlobalAttributes() {
    return [
      { types: sourceNodes, attributes: { sourceId: { default: null, rendered: false } } },
      { types: ['doc'], attributes: { frontMatter: { default: '', rendered: false } } },
    ]
  },
})

function styleAttribute(css: 'line-height' | 'margin-bottom' | 'margin-left') {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.getPropertyValue(css) || null,
    renderHTML: (attributes: Attributes) => {
      const key = { 'line-height': 'lineSpacing', 'margin-bottom': 'paragraphSpacing', 'margin-left': 'indent' }[css]
      const val = attributes[key]
      return typeof val === 'string' && /^(?:\d+(?:\.\d+)?)(?:px|rem|em|%)?$/.test(val) ? { style: `${css}: ${val}` } : {}
    },
  }
}

const Layout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() {
    return [
      { types: ['paragraph', 'heading'], attributes: {
        lineSpacing: styleAttribute('line-height'), paragraphSpacing: styleAttribute('margin-bottom'), indent: styleAttribute('margin-left'),
        displayStyle: {
          default: null,
          parseHTML: element => element.getAttribute('data-folio-style'),
          renderHTML: attrs => attrs.displayStyle ? { 'data-folio-style': attrs.displayStyle } : {},
        },
      } },
      { types: ['codeBlock', 'mermaid', 'blockMath'], attributes: {
        meta: { default: null, parseHTML: element => element.getAttribute('data-folio-meta'), renderHTML: attrs => attrs.meta ? { 'data-folio-meta': attrs.meta } : {} },
      } },
      { types: ['tableCell', 'tableHeader'], attributes: {
        cellAlign: {
          default: null,
          parseHTML: element => element.style.textAlign || null,
          renderHTML: attrs => ['left', 'center', 'right'].includes(attrs.cellAlign) ? { style: `text-align: ${attrs.cellAlign}` } : {},
        },
      } },
    ]
  },
})

function atomAttribute(key: string, fallback: string | null = '') {
  return {
    default: fallback,
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-folio-${key}`) ?? fallback,
    renderHTML: (attrs: Attributes) => attrs[key] ? { [`data-folio-${key}`]: attrs[key] } : {},
  }
}

export const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes: () => ({ kind: atomAttribute('kind', 'note') }),
  parseHTML: () => [{ tag: 'aside[data-folio-callout]', contentElement: '.callout-content' }],
  renderHTML: ({ node, HTMLAttributes }) => ['aside', mergeAttributes(HTMLAttributes, { 'data-folio-callout': '', class: 'callout' }),
    ['div', { class: 'callout-label', contenteditable: 'false' }, String(node.attrs.kind).replace(/^./, letter => letter.toUpperCase())],
    ['div', { class: 'callout-content' }, 0]],
})

function sourceAtom(name: string, tag: string, className: string, inline = false) {
  return Node.create({
    name, group: inline ? 'inline' : 'block', inline, atom: true, draggable: !inline,
    addAttributes: () => ({ value: atomAttribute('value'), label: atomAttribute('label', null) }),
    parseHTML: () => [{ tag: tag + '[data-folio-' + className + ']', priority: 80 }],
    renderHTML: ({ node, HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes, { [`data-folio-${className}`]: '', class: className }), node.attrs.label || node.attrs.value || ''],
    renderText: ({ node }) => node.attrs.label || node.attrs.value || '',
  })
}

export const RawBlock = sourceAtom('rawBlock', 'pre', 'raw-block')
export const RawInline = sourceAtom('rawInline', 'span', 'raw-inline', true)
export const MermaidBlock = sourceAtom('mermaid', 'pre', 'diagram')
export const BlockMath = sourceAtom('blockMath', 'div', 'block-math')
export const InlineMath = sourceAtom('inlineMath', 'span', 'inline-math', true)
export const WikiLink = sourceAtom('wikiLink', 'span', 'wiki-link', true)

export const Toc = Node.create({
  name: 'toc', group: 'block', atom: true, draggable: true,
  parseHTML: () => [{ tag: 'nav[data-folio-toc]' }],
  renderHTML: () => ['nav', { 'data-folio-toc': '' }, 'Table of contents'],
})

export const DocumentImage = Node.create({
  name: 'image', group: 'inline', inline: true, atom: true, draggable: true,
  addAttributes: () => ({
    src: { default: '', rendered: false }, alt: { default: '', rendered: false }, title: { default: null, rendered: false },
    caption: { default: null, rendered: false }, width: { default: null, rendered: false }, align: { default: null, rendered: false },
  }),
  parseHTML() {
    function attributes(element: HTMLElement) {
      const img = element instanceof HTMLImageElement ? element : element.querySelector('img')
      const src = img?.getAttribute('src') ?? ''
      if (!safeUrl(src, true)) return false
      return { src, alt: img?.getAttribute('alt') ?? '', title: img?.getAttribute('title') ?? null,
        width: img?.getAttribute('width') ?? null, caption: element.getAttribute('data-folio-caption'), align: element.getAttribute('data-folio-align') }
    }
    return [{ tag: 'span[data-folio-image]', getAttrs: attributes }, { tag: 'img[src]', getAttrs: attributes }]
  },
  renderHTML({ node }) {
    const { src, alt, title, width, caption, align } = node.attrs
    const image: [string, Record<string, string>] = ['img', { src: safeUrl(src, true) ? src : '', alt, ...(title ? { title } : {}), ...(/^\d+$/.test(width ?? '') ? { width } : {}) }]
    if (!caption && !width && !align) return image
    return ['span', { 'data-folio-image': '', class: 'document-image', ...(caption ? { 'data-folio-caption': caption } : {}), ...(align ? { 'data-folio-align': align } : {}) },
      image, ...(caption ? [['span', { class: 'image-caption' }, caption] as [string, Record<string, string>, string]] : [])]
  },
  renderText: ({ node }) => node.attrs.alt,
})

export function createExtensions(overrides: Extensions = []): Extensions {
  return [
    StarterKit.configure({ code: false, trailingNode: false, link: { openOnClick: false, autolink: true, isAllowedUri: value => safeUrl(value) } }),
    Code.extend({ excludes: 'code' }),
    TextStyleKit, TextAlign.configure({ types: ['paragraph', 'heading'] }), Superscript, Subscript,
    TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: true } }),
    Placeholder.configure({ placeholder: 'Start writing, or type / for commands…' }), SourceIdentity, Layout,
    ...[Callout, RawBlock, RawInline, MermaidBlock, BlockMath, InlineMath, WikiLink, Toc, DocumentImage]
      .map(extension => overrides.find(override => override.name === extension.name) ?? extension),
  ]
}
