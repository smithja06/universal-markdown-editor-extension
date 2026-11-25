import { SaxesParser, type SaxesTagNS } from 'saxes'
import { partSegment, readZip } from './readZip'

const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const PACKAGE_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const STRICT_RELS = 'http://purl.oclc.org/ooxml/officeDocument/relationships'
const WORD_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const RELS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml'
const MAX_XML_BYTES = 8 * 1024 * 1024
const MAX_XML_DEPTH = 64
const MAX_XML_ELEMENTS = 240_000
const MAX_XML_ATTRIBUTES = 64
const MAX_XML_TOTAL_ATTRIBUTES = 480_000

export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const STRICT_WORD_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main'

export interface XmlElement {
  tag: SaxesTagNS
  children: XmlElement[]
  text?: string
}

export function attribute(element: XmlElement, name: string, namespace = ''): string | undefined {
  return Object.values(element.tag.attributes).find(attr => attr.local === name && attr.uri === namespace)?.value
}

export function relationshipAttribute(element: XmlElement, name: string): string | undefined {
  const transitional = attribute(element, name, OFFICE_RELS)
  const strict = attribute(element, name, STRICT_RELS)
  if (transitional !== undefined && strict !== undefined) throw new Error('The DOCX has ambiguous relationship references.')
  return transitional ?? strict
}

export function isWord(element: XmlElement, name?: string): boolean {
  return (element.tag.uri === WORD_NS || element.tag.uri === STRICT_WORD_NS) &&
    (name === undefined || element.tag.local === name)
}

export function wordAttr(element: XmlElement, name = 'val'): string | undefined {
  return attribute(element, name, element.tag.uri)
}

export function wordChildren(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter(child => isWord(child, name))
}

export function wordChild(element: XmlElement, name: string): XmlElement | undefined {
  const children = wordChildren(element, name)
  if (children.length > 1) throw new Error(`The DOCX has ambiguous ${name} markup.`)
  return children[0]
}

function xmlReader(zip: ReturnType<typeof readZip>) {
  let elements = 0
  let attributes = 0
  return (part: string) => {
    const size = zip.size(part)
    if (size === undefined) throw new Error(`A required DOCX part is missing: ${part}.`)
    if (size > MAX_XML_BYTES) throw new Error(`DOCX XML part ${part} exceeds the size limit.`)
    const bytes = zip.read(part)
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
      : 'utf-8'
    function invalid(message: string): never {
      throw new Error(`Invalid DOCX XML in ${part}: ${message}`)
    }

    let xml: string
    try {
      xml = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    } catch {
      invalid('invalid Unicode encoding.')
    }
    const parser = new SaxesParser({ xmlns: true })
    const stack: XmlElement[] = []
    let root: XmlElement | undefined
    parser.on('xmldecl', declaration => {
      const declaredEncoding = declaration.encoding?.toLowerCase()
      if (declaration.version !== '1.0' || (declaredEncoding && declaredEncoding !== encoding &&
        !(encoding.startsWith('utf-16') && declaredEncoding === 'utf-16'))) {
        invalid('unsupported XML version or encoding.')
      }
    })
    parser.on('doctype', () => invalid('DTD processing is prohibited.'))
    parser.on('processinginstruction', () => invalid('processing instructions are unsupported.'))
    parser.on('error', () => invalid('malformed XML.'))
    parser.on('opentagstart', () => {
      if (++elements > MAX_XML_ELEMENTS) invalid('the document exceeds the XML element limit.')
      if (stack.length >= MAX_XML_DEPTH) invalid('the document exceeds the XML depth limit.')
    })
    let tagAttributes = 0
    parser.on('attribute', () => {
      if (++attributes > MAX_XML_TOTAL_ATTRIBUTES || ++tagAttributes > MAX_XML_ATTRIBUTES) {
        invalid('the document exceeds the XML attribute limit.')
      }
    })
    parser.on('opentag', tag => {
      tagAttributes = 0
      const element = { tag, children: [] }
      const parent = stack.at(-1)
      if (parent) parent.children.push(element)
      else root = element
      stack.push(element)
    })
    parser.on('closetag', () => { stack.pop() })
    const appendText = (text: string) => {
      const element = stack.at(-1)
      if (element) element.text = (element.text ?? '') + text
    }
    parser.on('text', appendText)
    parser.on('cdata', appendText)
    parser.write(xml).close()
    if (!root) invalid('missing root element.')
    return root
  }
}

function rootIs(element: XmlElement, namespace: string, name: string) {
  if (element.tag.uri !== namespace || element.tag.local !== name || element.text?.trim()) {
    throw new Error(`The DOCX package has invalid ${name} markup.`)
  }
}

function requiredAttribute(element: XmlElement, name: string): string {
  const value = attribute(element, name)
  if (!value || value.length > 8192 || /\p{Cc}/u.test(value)) {
    throw new Error(`The DOCX package has an invalid ${name} attribute.`)
  }
  return value
}

function resolvePart(source: string, target: string): string {
  const path = target.startsWith('/') || !source ? [] : source.split('/').slice(0, -1)
  const relative = target.startsWith('/') ? target.slice(1) : target
  for (const segment of relative.split('/')) {
    if (segment === '..') {
      if (!path.pop()) throw new Error('The DOCX relationship path leaves the package.')
    } else if (segment !== '.') {
      path.push(partSegment(segment))
    }
  }
  if (!path.length) throw new Error('The DOCX relationship has an invalid package path.')
  return path.join('/')
}

function contentTypes(root: XmlElement) {
  rootIs(root, TYPES_NS, 'Types')
  const extensions = new Map<string, string>()
  const parts = new Map<string, string>()
  for (const child of root.children) {
    if (child.tag.uri !== TYPES_NS || child.children.length || child.text?.trim()) {
      throw new Error('The DOCX has invalid content types.')
    }
    const type = requiredAttribute(child, 'ContentType').toLowerCase()
    if (/macroenabled|vba|activex/.test(type)) throw new Error('Macro-enabled DOCX documents are unsupported.')
    if (child.tag.local === 'Override') {
      const name = requiredAttribute(child, 'PartName')
      if (!name.startsWith('/')) throw new Error('The DOCX has an invalid content type path.')
      const part = name.slice(1).split('/').map(partSegment).join('/')
      if (parts.has(part)) throw new Error('The DOCX has ambiguous content types.')
      parts.set(part, type)
    } else if (child.tag.local === 'Default') {
      const extension = partSegment(requiredAttribute(child, 'Extension'))
      if (extension.includes('.') || extensions.has(extension)) throw new Error('The DOCX has ambiguous content types.')
      extensions.set(extension, type)
    } else {
      throw new Error('The DOCX has unsupported content type markup.')
    }
  }
  return (part: string) => {
    const filename = part.split('/').at(-1) ?? ''
    const extension = filename.includes('.') ? filename.split('.').at(-1)! : ''
    return parts.get(part) ?? extensions.get(extension)
  }
}

export interface Relationship {
  id: string
  kind: string
  external: boolean
  target: string
}

function relationships(root: XmlElement, source: string, exists: (part: string) => boolean) {
  rootIs(root, PACKAGE_RELS_NS, 'Relationships')
  const result = new Map<string, Relationship>()
  for (const child of root.children) {
    rootIs(child, PACKAGE_RELS_NS, 'Relationship')
    if (child.children.length) throw new Error('The DOCX package has an invalid relationship.')
    const id = requiredAttribute(child, 'Id')
    const type = requiredAttribute(child, 'Type')
    const target = requiredAttribute(child, 'Target')
    const mode = attribute(child, 'TargetMode')
    if (result.has(id)) throw new Error('The DOCX package has duplicate relationship identifiers.')
    if (mode !== undefined && mode !== 'Internal' && mode !== 'External') {
      throw new Error('The DOCX package has an invalid relationship mode.')
    }
    const external = mode === 'External'
    const destination = external ? target : resolvePart(source, target)
    if (!external && !exists(destination)) throw new Error(`The DOCX relationship target is missing: ${destination}.`)
    if (/\/vba|\/activex/i.test(type)) throw new Error('Macro-enabled DOCX documents are unsupported.')
    const split = type.lastIndexOf('/')
    const family = type.slice(0, split)
    let kind = type
    if (family === OFFICE_RELS || family === STRICT_RELS) kind = type.slice(split + 1)
    if (type === `${PACKAGE_RELS_NS}/metadata/core-properties`) kind = 'core-properties'
    if (type === `${PACKAGE_RELS_NS}/metadata/thumbnail`) kind = 'thumbnail'
    result.set(id, { id, kind, external, target: destination })
  }
  return result
}

export function relatedPart(relationships: Map<string, Relationship>, kind: string): string | undefined {
  const related = [...relationships.values()].filter(item => item.kind === kind)
  if (related.length > 1 || related[0]?.external) {
    throw new Error(`The DOCX ${kind} relationship is ambiguous or external.`)
  }
  return related[0]?.target
}

export function readPackage(bytes: Uint8Array<ArrayBuffer>) {
  const zip = readZip(bytes)
  const xml = xmlReader(zip)
  const typeFor = contentTypes(xml('[content_types].xml'))
  const packageParts = new Set(zip.names)
  const rels = new Map<string, Map<string, Relationship>>()
  for (const part of packageParts) {
    if (part === '[content_types].xml') continue
    const type = typeFor(part)
    if (/(?:^|\/)(?:vbaproject|vbadata)\./.test(part)) throw new Error('Macro-enabled DOCX documents are unsupported.')
    const relationPart = /^(?:(.*)\/)?_rels\/([^/]*\.rels)$/.exec(part)
    if ((type === RELS_TYPE) !== Boolean(relationPart)) {
      throw new Error('The DOCX package has invalid relationship content types or paths.')
    }
    if (!relationPart) {
      if (!type) throw new Error(`A DOCX package part has no content type: ${part}.`)
      continue
    }
    const source = (relationPart[1] ? `${relationPart[1]}/` : '') + relationPart[2].slice(0, -5)
    if (part !== '_rels/.rels' && !packageParts.has(source)) {
      throw new Error('The DOCX has a relationship for a missing package part.')
    }
    if (rels.has(source)) throw new Error('The DOCX has ambiguous relationship sources.')
    rels.set(source, relationships(xml(part), source, target => packageParts.has(target) && target !== '[content_types].xml'))
  }

  const rootRelationships = rels.get('')
  const main = rootRelationships && relatedPart(rootRelationships, 'officeDocument')
  if (!main || typeFor(main) !== WORD_MAIN) throw new Error('The package does not identify an ordinary Word DOCX main document.')
  const mainRelationships = rels.get(main) ?? new Map<string, Relationship>()
  return { main, mainRelationships, rootRelationships, xml, verifyRemaining: zip.verifyRemaining }
}
