import { SaxesParser, type SaxesTagNS } from 'saxes'
import { partSegment, readZip } from '../docx/readZip'

export const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'

export interface XmlNode {
  name: string
  local: string
  namespace: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
  relationship?: string
}

export const decodeXml = new TextDecoder('utf-8', { fatal: true })
export const encodeXml = new TextEncoder()

export function xmlReader() {
  let elements = 0
  let attributes = 0
  return (bytes: Uint8Array) => {
    let root: XmlNode | undefined
    const stack: XmlNode[] = []
    const parser = new SaxesParser({ xmlns: true })
    parser.on('xmldecl', declaration => {
      if (declaration.version !== '1.0' || declaration.encoding && !/^utf-8$/i.test(declaration.encoding)) throw new Error('Only UTF-8 XLSX XML is supported.')
    })
    parser.on('doctype', () => { throw new Error('DTD declarations are prohibited in XLSX.') })
    parser.on('processinginstruction', () => { throw new Error('Processing instructions are unsupported in XLSX.') })
    parser.on('error', () => { throw new Error('A workbook package part contains malformed XML.') })
    let tagAttributes = 0
    parser.on('attribute', () => {
      if (++attributes > 1_100_000 || ++tagAttributes > 64) throw new Error('The workbook exceeds the XML attribute limit.')
    })
    parser.on('opentagstart', () => {
      if (++elements > 850_000 || stack.length >= 48) throw new Error('The workbook exceeds the XML complexity limit.')
    })
    parser.on('opentag', (tag: SaxesTagNS) => {
      tagAttributes = 0
      const attrs = Object.values(tag.attributes)
      const element: XmlNode = {
        name: tag.name, local: tag.local, namespace: tag.uri, children: [], text: '',
        attrs: Object.fromEntries(attrs.map(attribute => [attribute.name, attribute.value])),
        relationship: attrs.find(attribute => attribute.uri === relationshipNamespace && attribute.local === 'id')?.value,
      }
      const parent = stack.at(-1)
      if (parent) parent.children.push(element)
      else root = element
      stack.push(element)
    })
    parser.on('closetag', () => { stack.pop() })
    const append = (text: string) => {
      const node = stack.at(-1)
      if (node) node.text += text
    }
    parser.on('text', append)
    parser.on('cdata', append)
    parser.write(decodeXml.decode(bytes)).close()
    if (!root) throw new Error('An XLSX XML part has no document element.')
    return root
  }
}

export function child(node: XmlNode | undefined, local: string) {
  return node?.children.find(value => value.local === local && value.namespace === node.namespace)
}

export function children(node: XmlNode | undefined, local: string) {
  return node?.children.filter(value => value.local === local && value.namespace === node.namespace) ?? []
}

export function element(local: string, attrs: Record<string, string> = {}, text = '', children: XmlNode[] = []): XmlNode {
  return { name: local, local, namespace: sheetNamespace, attrs, text, children }
}

function escapeXml(value: string, attribute = false) {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;')
  return attribute ? escaped.replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;') : escaped
}

function serialize(node: XmlNode): string {
  const attrs = Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escapeXml(value, true)}"`).join('')
  const body = escapeXml(node.text) + node.children.map(serialize).join('')
  return body ? `<${node.name}${attrs}>${body}</${node.name}>` : `<${node.name}${attrs}/>`
}

export function xmlBytes(root: XmlNode) {
  return encodeXml.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + serialize(root))
}

export function packagePath(source: string, target: string) {
  const path = target.startsWith('/') ? [] : source.split('/').slice(0, -1)
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (segment === '..') {
      if (!path.pop()) throw new Error('An XLSX relationship leaves the package.')
    } else if (segment !== '.') path.push(partSegment(segment))
  }
  return path.join('/')
}

export function relationshipPath(part: string) {
  const index = part.lastIndexOf('/')
  return part.slice(0, index + 1) + '_rels/' + part.slice(index + 1) + '.rels'
}

export interface Relation { id: string; type: string; target: string; external: boolean }

export function relations(root: XmlNode, part: string) {
  if (root.local !== 'Relationships' || root.namespace !== packageNamespace) throw new Error('Invalid XLSX relationships.')
  const result = new Map<string, Relation>()
  for (const relationship of children(root, 'Relationship')) {
    const { Id: id, Type: type, Target: target, TargetMode: mode } = relationship.attrs
    if (!id || !type || !target || target.length > 8192 || result.has(id) || mode && mode !== 'External' && mode !== 'Internal') {
      throw new Error('An XLSX relationship is invalid or ambiguous.')
    }
    const external = mode === 'External'
    result.set(id, { id, type, external, target: external ? target : packagePath(part, target) })
  }
  return result
}

export function writeRelations(items: Iterable<Relation>) {
  const root = element('Relationships', { xmlns: packageNamespace })
  root.children = [...items].map(relation => element('Relationship', {
    Id: relation.id, Type: relation.type, Target: relation.external ? relation.target : '/' + relation.target,
    ...(relation.external ? { TargetMode: 'External' } : {}),
  }))
  return xmlBytes(root)
}

export function spreadsheetZip(bytes: Uint8Array<ArrayBuffer>) {
  try { return readZip(bytes) } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new Error(error.message.replace(/DOCX/g, 'XLSX').replace('Word files', 'Excel files'), { cause: error })
  }
}

export function isTrue(value: string | undefined) {
  return value === '1' || value === 'true'
}
