import DOMPurify from 'dompurify'
import { DOMParser, DOMSerializer, type Mark, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { safeUrl } from '../editor/schema'

const typography = {
  color: 'color', backgroundColor: 'background-color', fontFamily: 'font-family',
  fontSize: 'font-size', lineHeight: 'line-height',
}
const layoutStyles = ['text-align', 'line-height', 'margin-bottom', 'margin-left']
const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'pre', 'ul', 'ol', 'table', 'aside', 'nav', 'div'])
const basicMarks = new Set(['strong', 'b', 'em', 'i', 's', 'strike', 'del', 'u', 'sup', 'sub', 'code'])
const attributes: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel', 'class'],
  img: ['src', 'alt', 'title', 'width'],
  ol: ['start', 'type'], ul: ['data-type'], li: ['data-type', 'data-checked'],
  table: ['style'], col: ['style', 'width'], th: ['style', 'colspan', 'rowspan', 'colwidth', 'data-colwidth'],
  td: ['style', 'colspan', 'rowspan', 'colwidth', 'data-colwidth'],
  pre: ['data-folio-meta', 'data-folio-raw-block', 'data-folio-diagram', 'data-folio-value', 'data-folio-label', 'class'],
  code: ['class'],
  span: ['style', 'class', 'data-folio-image', 'data-folio-caption', 'data-folio-align', 'data-folio-inline-math', 'data-folio-wiki-link', 'data-folio-raw-inline', 'data-folio-value', 'data-folio-label'],
  div: ['class', 'contenteditable', 'data-folio-block-math', 'data-folio-value', 'data-folio-label', 'data-folio-meta'],
  aside: ['class', 'data-folio-callout', 'data-folio-kind'],
  nav: ['data-folio-toc'],
  input: ['type', 'checked', 'disabled', 'aria-label'],
}
const structuralTags = new Set(['br', 'label', 'tbody', 'thead', 'tfoot', 'tr', 'colgroup'])

function templateFor(html: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function styleAllowed(element: HTMLElement, keys: string[]) {
  const raw = element.getAttribute('style')
  if (!raw) return true
  // Check the original declarations too. CSSOM can silently drop unknown properties.
  return raw.split(';').every(declaration => {
    if (!declaration.trim()) return true
    const key = declaration.split(':', 1)[0].trim().toLowerCase()
    return keys.includes(key) && !!element.style.getPropertyValue(key) && !element.style.getPropertyPriority(key)
  })
}

function supportedElement(element: HTMLElement): boolean {
  const tag = element.localName
  const layout = tag === 'p' || /^h[1-6]$/.test(tag)
  const allowed = layout ? ['style', 'data-folio-style'] : attributes[tag] ?? []
  if (!layout && !attributes[tag] && !blocks.has(tag) && !basicMarks.has(tag) && !structuralTags.has(tag)) return false
  if (Array.from(element.attributes).some(attr => !allowed.includes(attr.name))) return false
  if (tag === 'a' && !safeUrl(element.getAttribute('href') ?? '')) return false
  if (tag === 'img' && !safeUrl(element.getAttribute('src') ?? '', true)) return false
  if (tag === 'input' && element.getAttribute('type') !== 'checkbox') return false
  if (tag === 'span' && element.hasAttribute('class') && !['image-caption', 'document-image', 'inline-math', 'wiki-link', 'raw-inline'].includes(element.className)) return false
  if (tag === 'pre' && element.hasAttribute('class') && !['raw-block', 'diagram'].includes(element.className)) return false
  if (tag === 'code' && element.hasAttribute('class') &&
    (element.parentElement?.localName !== 'pre' || !/^language-\S+$/.test(element.className))) return false
  if (tag === 'div' && !element.hasAttribute('data-folio-block-math') && !['callout-label', 'callout-content'].includes(element.className)
    && (element.attributes.length !== 0 || element.parentElement?.getAttribute('data-type') !== 'taskItem')) return false
  if (tag === 'aside' && !element.hasAttribute('data-folio-callout')) return false
  if (tag === 'nav' && !element.hasAttribute('data-folio-toc')) return false
  if (layout && element.hasAttribute('data-folio-style') && !['title', 'subtitle'].includes(element.getAttribute('data-folio-style') ?? '')) return false
  if (element.hasAttribute('style')) {
    const keys = layout ? layoutStyles : tag === 'span' ? Object.values(typography) : tag === 'td' || tag === 'th' ? ['text-align'] : ['width', 'min-width']
    if (!styleAllowed(element, keys)) return false
  }
  return Array.from(element.childNodes).every(child => child.nodeType === globalThis.Node.TEXT_NODE ||
    child instanceof HTMLElement && supportedElement(child))
}

function onlyElement(parent: ParentNode): HTMLElement | undefined {
  const item = parent.firstElementChild
  if (!(item instanceof HTMLElement) || Array.from(parent.childNodes).some(child => child !== item &&
    (child.nodeType !== globalThis.Node.TEXT_NODE || !!child.textContent?.trim()))) return undefined
  return item
}

export function isLegacyBlock(raw: string) {
  if (!raw.includes('data-folio-block')) return false
  const element = onlyElement(templateFor(raw))
  return element?.localName === 'div' && element.getAttribute('data-folio-block') === '1'
}

export function readBlockHtml(raw: string, schema: Schema): ProseMirrorNode | undefined {
  const original = templateFor(raw)
  const element = onlyElement(original)
  if (!element) return undefined
  const tag = element.localName
  if (tag !== 'img' && tag !== 'hr' && raw.slice(raw.lastIndexOf('</')).trim().toLowerCase().replace(/\s/g, '') !== '</' + tag + '>') return undefined
  const legacy = element.localName === 'div' && element.getAttribute('data-folio-block') === '1'
  const block = legacy ? onlyElement(element) : element
  if (!block || legacy && element.attributes.length !== 1 || !blocks.has(block.localName) && block.localName !== 'img' || !supportedElement(block)) return undefined
  const source = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['form', 'iframe', 'template', 'button'] })
  const sanitized = templateFor(source)
  const sanitizedBlock = legacy ? onlyElement(onlyElement(sanitized) ?? sanitized) : onlyElement(sanitized)
  if (!sanitizedBlock) return undefined
  const parent = document.createDocumentFragment()
  parent.append(sanitizedBlock)
  const result = DOMParser.fromSchema(schema).parse(parent, { preserveWhitespace: 'full' })
  return result.childCount === 1 ? result.firstChild ?? undefined : undefined
}

export function readInlineImage(raw: string, schema: Schema): ProseMirrorNode | undefined {
  if (!/^<img(?:\s|\/?>)/i.test(raw)) return undefined
  const fragment = templateFor(raw)
  const element = onlyElement(fragment)
  // Missing alternative text is distinct from an explicitly decorative image.
  if (element?.localName !== 'img' || !element.hasAttribute('alt') || !supportedElement(element)) return undefined
  const width = element.getAttribute('width')
  if (width !== null && !/^\d+$/.test(width)) return undefined
  const image = DOMParser.fromSchema(schema).parse(fragment).firstChild?.firstChild
  return image?.type.name === 'image' ? image : undefined
}

export function readInlineOpening(raw: string, schema: Schema): { tag: string; marks?: readonly Mark[] } | undefined {
  const probe = 'folio-inline-content'
  const container = templateFor(raw + probe)
  const element = onlyElement(container)
  if (!element || element.textContent !== probe || element.childNodes.length !== 1) return undefined
  const tag = element.localName
  if ((!basicMarks.has(tag) && tag !== 'span' && tag !== 'a') || !supportedElement(element) ||
    tag === 'span' && (element.attributes.length !== 1 || !element.hasAttribute('style'))) return { tag }
  const parsed = DOMParser.fromSchema(schema).parse(container, { preserveWhitespace: 'full' }).firstChild?.firstChild
  return { tag, marks: parsed?.isText && parsed.marks.length ? parsed.marks : undefined }
}

export function htmlMarkTags(mark: Mark): [string, string] | undefined {
  const serializer = DOMSerializer.fromSchema(mark.type.schema).marks[mark.type.name]
  const spec = serializer?.(mark, true)
  if (!spec) return undefined
  const { dom } = DOMSerializer.renderSpec(document, spec)
  if (!(dom instanceof HTMLElement)) return undefined
  const close = '</' + dom.localName + '>'
  return [dom.outerHTML.slice(0, -close.length), close]
}

export function normalizeStyleMarks(mark: Mark) {
  if (mark.type.name !== 'textStyle') return mark.toJSON()
  const style = document.createElement('span').style
  const attrs = { ...mark.attrs }
  for (const [key, css] of Object.entries(typography)) {
    if (typeof attrs[key] !== 'string') continue
    if (!attrs[key]) { attrs[key] = null; continue }
    style.setProperty(css, attrs[key])
    attrs[key] = style.getPropertyValue(css) || attrs[key]
  }
  return { type: mark.type.name, attrs }
}

export function writeHtml(node: ProseMirrorNode, legacyWrapper = false) {
  const dom = DOMSerializer.fromSchema(node.type.schema).serializeNode(node)
  if (!(dom instanceof HTMLElement)) throw new Error('This block could not be converted to HTML.')
  if (!legacyWrapper) return singleLine(dom.outerHTML)
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-folio-block', '1')
  wrapper.append(dom)
  return singleLine(wrapper.outerHTML)
}

function singleLine(html: string) {
  return html.replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
}
