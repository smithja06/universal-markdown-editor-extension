import type { Workbook, XlsxCoreProperty } from './model'
import { element, relationshipNamespace, relations, writeRelations, xmlBytes, type XmlNode } from './xlsxXml'

const coreNamespace = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
const dublinCore = 'http://purl.org/dc/elements/1.1/'
const dublinTerms = 'http://purl.org/dc/terms/'
const customNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
const variantNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'
const customType = 'application/vnd.openxmlformats-officedocument.custom-properties+xml'
const coreFields = {
  title: ['dc', dublinCore], subject: ['dc', dublinCore], creator: ['dc', dublinCore], description: ['dc', dublinCore],
  identifier: ['dc', dublinCore], language: ['dc', dublinCore],
  keywords: ['cp', coreNamespace], lastModifiedBy: ['cp', coreNamespace], revision: ['cp', coreNamespace],
  category: ['cp', coreNamespace], contentStatus: ['cp', coreNamespace], version: ['cp', coreNamespace],
  created: ['dcterms', dublinTerms], modified: ['dcterms', dublinTerms],
} as const satisfies Record<XlsxCoreProperty, readonly [string, string]>
const coreKeys = Object.keys(coreFields) as XlsxCoreProperty[]

function coreValue(key: XlsxCoreProperty, value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && !/[\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value) &&
    ![...value].some(char => char.charCodeAt(0) < 32 && char !== '\t' && char !== '\n' && char !== '\r') &&
    (key !== 'created' && key !== 'modified' || /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
}

export function readCoreProperties(root: XmlNode | undefined, warnings: Set<string>): Workbook['coreProperties'] {
  if (!root) return
  if (root.namespace !== coreNamespace || root.local !== 'coreProperties') throw new Error('Invalid XLSX workbook properties.')
  const output: NonNullable<Workbook['coreProperties']> = {}
  for (const node of root.children) {
    const key = coreKeys.find(name => name === node.local && coreFields[name][1] === node.namespace)
    if (key && !node.children.length && coreValue(key, node.text)) output[key] = node.text
    else if (node.text || node.children.length) warnings.add('Some workbook properties are omitted from the edited copy.')
  }
  return Object.keys(output).length ? output : undefined
}

export function readRegionalProperties(root: XmlNode | undefined, warnings: Set<string>) {
  let locale = 'en-US'
  let timezone = 'UTC'
  if (!root) return { locale, timezone }
  if (root.local !== 'Properties' || root.namespace !== customNamespace) throw new Error('Invalid XLSX custom workbook properties.')
  for (const property of root.children) {
    const { name } = property.attrs
    const value = property.children.find(node => node.local === 'lpwstr' && node.namespace === variantNamespace)?.text
    try {
      if (!value || value.length > 128) throw new Error()
      if (name === 'Folio.Locale') {
        locale = Intl.getCanonicalLocales(value)[0] ?? locale
        continue
      }
      if (name === 'Folio.Timezone') {
        timezone = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone
        continue
      }
    } catch {
      warnings.add('Some custom workbook properties are omitted from the edited copy.')
      continue
    }
    warnings.add('Some custom workbook properties are omitted from the edited copy.')
  }
  return { locale, timezone }
}

export function writeWorkbookMetadata(workbook: Workbook, parts: Record<string, Uint8Array>, parse: (bytes: Uint8Array) => XmlNode) {
  if (workbook.coreProperties) {
    const path = 'docProps/core.xml'
    const root = parse(parts[path])
    for (const key of coreKeys) {
      const value = workbook.coreProperties[key]
      if (value === undefined) continue
      if (!coreValue(key, value)) throw new Error('A workbook property contains an unsupported value.')
      const [prefix, namespace] = coreFields[key]
      const current = root.children.find(node => node.local === key && node.namespace === namespace)
      if (current) current.text = value
      else {
        const node = element(key, {}, value)
        node.name = prefix + ':' + key
        root.children.push(node)
      }
    }
    parts[path] = xmlBytes(root)
  }

  const locale = Intl.getCanonicalLocales(workbook.locale)[0]
  const timezone = new Intl.DateTimeFormat('en', { timeZone: workbook.timezone }).resolvedOptions().timeZone
  if (locale === 'en-US' && timezone === 'UTC') return
  const path = 'docProps/custom.xml'
  const custom = element('Properties', { xmlns: customNamespace, 'xmlns:vt': variantNamespace })
  const values = { 'Folio.Locale': locale, 'Folio.Timezone': timezone }
  for (const [index, [name, value]] of Object.entries(values).entries()) {
    const item = element('lpwstr', {}, value)
    item.name = 'vt:lpwstr'
    custom.children.push(element('property', { fmtid: '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}', pid: String(index + 2), name }, '', [item]))
  }
  parts[path] = xmlBytes(custom)
  const types = parse(parts['[Content_Types].xml'])
  types.children.push(element('Override', { PartName: '/' + path, ContentType: customType }))
  parts['[Content_Types].xml'] = xmlBytes(types)

  const items = relations(parse(parts['_rels/.rels']), '')
  items.set('rIdFolioCustom', { id: 'rIdFolioCustom', type: relationshipNamespace + '/custom-properties', target: 'docprops/custom.xml', external: false })
  // OPC targets are case sensitive. Canonicalize for inspection but retain
  // the writer’s actual part names when publishing relationship targets.
  const originalNames = new Map(Object.keys(parts).map(name => [name.toLowerCase(), name]))
  parts['_rels/.rels'] = writeRelations([...items.values()].map(item => ({ ...item, target: item.external ? item.target : originalNames.get(item.target) ?? item.target })))
}
