import type { JSONContent } from '@tiptap/core'
import { zipSync } from 'fflate'
import { canonicalDocx, docxColumnWidth, docxColumnWidthValue, docxMaxFileBytes, docxMaxXmlElements, docxMaxXmlPartBytes } from './model'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageNamespace = 'http://schemas.openxmlformats.org/package/2006/'
const wordContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml'
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const tableStyles = ['TableGrid', 'FolioTableGrid'] as const

interface NumberedList {
  id: number
  ordered: boolean
  start: number
}

const xmlEscapes: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;', '\n': '&#10;',
}

function checkPartLength(length: number) {
  if (length > docxMaxXmlPartBytes) throw new Error('A DOCX XML part exceeds the supported size.')
}

function escapeXml(value: string): string {
  // eslint-disable-next-line no-control-regex -- Reject XML 1.0 controls and unpaired UTF-16 surrogates before encoding.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) {
    throw new Error('The document contains characters that Word XML cannot store.')
  }
  let length = value.length
  return value.replace(/[&<>"'\r\n]/g, character => {
    const escaped = xmlEscapes[character]
    length += escaped.length - 1
    checkPartLength(length)
    return escaped
  })
}

function relationships(content: string): string {
  return `<Relationships xmlns="${packageNamespace}relationships">${content}</Relationships>`
}

function relationship(id: string, kind: string, target: string, external = false): string {
  return `<Relationship Id="${id}" Type="${office}/${kind}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`
}

function contentTypes(hasNumbering: boolean): string {
  const overrides = [
    ['/word/document.xml', 'document.main'],
    ['/word/styles.xml', 'styles'],
  ]
  if (hasNumbering) overrides.push(['/word/numbering.xml', 'numbering'])
  return `<Types xmlns="${packageNamespace}content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${overrides.map(([filename, kind]) => `<Override PartName="${filename}" ContentType="${wordContentType}.${kind}+xml"/>`).join('')}
</Types>`
}

function styles(): string {
  const headings = [36, 32, 28, 26, 24, 22].map((size, index) => {
    const level = index + 1
    return `<w:style w:type="paragraph" w:styleId="Heading${level}">
<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${index}"/></w:pPr>
<w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>
</w:style>`
  })
  return `<w:styles xmlns:w="${word}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${headings.join('')}
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="${tableStyles[0]}"><w:name w:val="Table Grid"/></w:style>
<w:style w:type="table" w:styleId="${tableStyles[1]}"><w:name w:val="Folio Table Grid"/><w:basedOn w:val="${tableStyles[0]}"/></w:style>
</w:styles>`
}

function numbering(lists: NumberedList[]): string {
  function abstractList(id: number, format: string, label: string): string {
    return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${label}"/><w:lvlJc w:val="left"/>
<w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr>
</w:lvl></w:abstractNum>`
  }
  const instances = lists.map(list => {
    const override = list.ordered
      ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${list.start}"/></w:lvlOverride>` : ''
    return `<w:num w:numId="${list.id}"><w:abstractNumId w:val="${list.ordered ? 1 : 0}"/>${override}</w:num>`
  })
  return `<w:numbering xmlns:w="${word}">${abstractList(0, 'bullet', '•')}${abstractList(1, 'decimal', '%1.')}${instances.join('')}</w:numbering>`
}

function run(node: JSONContent): string {
  const marks = node.marks ?? []
  const properties = [
    marks.some(mark => mark.type === 'link') ? '<w:rStyle w:val="Hyperlink"/>' : '',
    marks.some(mark => mark.type === 'bold') ? '<w:b/><w:bCs/>' : '',
    marks.some(mark => mark.type === 'italic') ? '<w:i/><w:iCs/>' : '',
    marks.some(mark => mark.type === 'underline') ? '<w:u w:val="single"/>' : '',
  ].join('')
  const value = node.type === 'hardBreak' ? '<w:br/>' : node.text!.split(/(\t)/)
    .filter(Boolean)
    .map(segment => segment === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${escapeXml(segment)}</w:t>`)
    .join('')
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${value}</w:r>`
}

export function writeDocx(document: JSONContent): Uint8Array<ArrayBuffer> {
  const model = canonicalDocx(document)
  const links = new Map<string, string>()
  const linkRelationships: string[] = []
  const lists: NumberedList[] = []
  let linkCharacters = 0
  let inlineCharacters = 0
  let tabs = 0
  let tableCount = 0

  function linkId(href: string): string {
    const knownId = links.get(href)
    if (knownId) return knownId
    const id = `link${links.size + 1}`
    const entry = relationship(id, 'hyperlink', href, true)
    linkCharacters += entry.length
    checkPartLength(linkCharacters)
    links.set(href, id)
    linkRelationships.push(entry)
    return id
  }

  function paragraph(node: JSONContent, properties = ''): string {
    const contents: string[] = []
    let currentLink: string | undefined
    for (const inline of node.content ?? []) {
      const href: string | undefined = inline.marks?.find(mark => mark.type === 'link')?.attrs?.href
      if (href !== currentLink) {
        if (currentLink) contents.push('</w:hyperlink>')
        if (href) contents.push(`<w:hyperlink r:id="${linkId(href)}">`)
        currentLink = href
      }
      const text = inline.text
      if (text) {
        // Each tab becomes its own XML element. Count before splitting long text runs.
        for (let index = text.indexOf('\t'); index >= 0; index = text.indexOf('\t', index + 1)) {
          if (++tabs > docxMaxXmlElements) throw new Error('The document exceeds the DOCX XML element limit.')
        }
      }
      const renderedRun = run(inline)
      inlineCharacters += renderedRun.length
      checkPartLength(inlineCharacters)
      contents.push(renderedRun)
    }
    if (currentLink) contents.push('</w:hyperlink>')
    return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${contents.join('')}</w:p>`
  }

  function list(node: JSONContent): string {
    const ordered = node.type === 'orderedList'
    const id = lists.length + 1
    lists.push({ id, ordered, start: ordered ? node.attrs!.start : 1 })
    const properties = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`
    return node.content!.map(item => paragraph(item.content![0], properties)).join('')
  }

  function table(node: JSONContent): string {
    const rows = node.content!
    const columns = rows[0].content!.length
    // Microsoft Word rejects table rows containing more than 63 cells.
    if (columns > 63) throw new Error('Word tables support at most 63 columns.')
    const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="auto"/>`).join('')
    // Word combines adjacent tables with an identical style. Both styles use the same grid appearance.
    const style = tableStyles[tableCount++ % tableStyles.length]
    // Column widths are twips. A fully specified grid uses fixed layout so Word keeps the widths. Columns without a width size automatically.
    const widths = rows[0].content!.map(cell => docxColumnWidthValue(cell.attrs?.colwidth))
    const twips = widths.map(width => width === undefined ? undefined : width * docxColumnWidth.twips)
    const fixed = twips.every(width => width !== undefined)
    const tableWidth = fixed ? `<w:tblW w:w="${twips.reduce((sum, width) => sum! + width!, 0)}" w:type="dxa"/>` : '<w:tblW w:w="0" w:type="auto"/>'
    const geometry = `<w:tblPr><w:tblStyle w:val="${style}"/>${tableWidth}<w:tblBorders>${border}</w:tblBorders>${fixed ? '<w:tblLayout w:type="fixed"/>' : ''}</w:tblPr>
<w:tblGrid>${twips.map(width => width === undefined ? '<w:gridCol/>' : `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`
    const body = rows.map(row => {
      const cells = row.content!
      const header = cells[0].type === 'tableHeader' ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
      return `<w:tr>${header}${cells.map((cell, index) => `<w:tc>${twips[index] === undefined ? '' : `<w:tcPr><w:tcW w:w="${twips[index]}" w:type="dxa"/></w:tcPr>`}${cell.content!.map(p => paragraph(p)).join('')}</w:tc>`).join('')}</w:tr>`
    }).join('')
    return `<w:tbl>${geometry}${body}</w:tbl>`
  }

  const body = model.content!.map(node => {
    if (node.type === 'heading') return paragraph(node, `<w:pStyle w:val="Heading${node.attrs!.level}"/>`)
    if (node.type === 'table') return table(node)
    if (node.type === 'bulletList' || node.type === 'orderedList') return list(node)
    return paragraph(node)
  }).join('')
  const documentRelationships = [relationship('styles', 'styles', 'styles.xml')]
  if (lists.length) documentRelationships.push(relationship('numbering', 'numbering', 'numbering.xml'))
  const parts: Record<string, string> = {
    '[Content_Types].xml': contentTypes(lists.length > 0),
    '_rels/.rels': relationships(relationship('document', 'officeDocument', 'word/document.xml')),
    'word/document.xml': `<w:document xmlns:w="${word}" xmlns:r="${office}"><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': styles(),
    'word/_rels/document.xml.rels': relationships(documentRelationships.join('') + linkRelationships.join('')),
  }
  if (lists.length) parts['word/numbering.xml'] = numbering(lists)
  const encoder = new TextEncoder()
  const encoded = Object.fromEntries(Object.entries(parts).map(([path, part]) => {
    const bytes = encoder.encode(xmlHeader + part)
    checkPartLength(bytes.byteLength)
    return [path, bytes]
  }))
  // Store the parts directly so highly repetitive edits also meet the import compression-ratio limit.
  const bytes = zipSync(encoded, { level: 0 })
  if (bytes.byteLength > docxMaxFileBytes) throw new Error('The DOCX file exceeds the supported size.')
  return bytes
}
