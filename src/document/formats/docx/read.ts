import type { JSONContent } from '@tiptap/core'
import { canonicalDocx, safeDocxLink, type DocxIssue } from './model'
import { enabled, readNumbering, readStyles, rejectHiddenProperties } from './readDefinitions'
import {
  isWord, readPackage, relatedPart, relationshipAttribute, wordAttr, wordChild, wordChildren,
  type Relationship, type XmlElement,
} from './readPackage'

const relationshipLosses: Record<string, [string, string]> = {
  header: ['headers', 'Headers'],
  footer: ['footers', 'Footers'],
  image: ['images', 'Images and drawings'],
  chart: ['charts', 'Charts'],
  comments: ['comments', 'Comments'],
  footnotes: ['footnotes', 'Footnotes'],
  endnotes: ['endnotes', 'Endnotes'],
  oleObject: ['objects', 'Embedded objects'],
  package: ['objects', 'Embedded objects'],
  glossaryDocument: ['glossary', 'Building blocks'],
  customXml: ['custom-xml', 'Custom XML data'],
  attachedTemplate: ['templates', 'Attached templates'],
  'core-properties': ['core-properties', 'Document properties'],
  'extended-properties': ['extended-properties', 'Document properties'],
  'custom-properties': ['custom-properties', 'Custom document properties'],
  thumbnail: ['thumbnail', 'Document thumbnail'],
}

const inlineLosses: Record<string, [string, string]> = {
  drawing: relationshipLosses.image,
  pict: relationshipLosses.image,
  object: relationshipLosses.oleObject,
  commentRangeStart: relationshipLosses.comments,
  commentRangeEnd: relationshipLosses.comments,
  commentReference: relationshipLosses.comments,
  footnoteReference: relationshipLosses.footnotes,
  endnoteReference: relationshipLosses.endnotes,
  bookmarkStart: ['bookmarks', 'Bookmarks'],
  bookmarkEnd: ['bookmarks', 'Bookmarks'],
  permStart: ['editing-permissions', 'Editing permissions'],
  permEnd: ['editing-permissions', 'Editing permissions'],
}
const mathNamespaces = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/math',
  'http://purl.oclc.org/ooxml/officeDocument/math',
])
const drawingNamespaces = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
])
const mainDefinitionRelationships = new Set(['numbering', 'settings', 'styles'])
const passiveRunMetadata = new Set(['lang', 'noProof', 'rPr', 'lastRenderedPageBreak'])
const unsupportedRevisions = /^(?:ins|del|moveFrom.*|moveTo.*|customXml(?:Ins|Del|Move).*|.*PrChange|tblGridChange|cellIns|cellDel|cellMerge)$/

type Mark = NonNullable<JSONContent['marks']>[number]

function unsupported(element: XmlElement, location: string): never {
  throw new Error(`The DOCX contains unsupported ${element.tag.local} content at ${location}, whose editable content cannot be determined reliably.`)
}

function requireContainer(element: XmlElement, location: string) {
  if (element.text?.trim()) unsupported(element, location)
}

function containsTextBox(element: XmlElement): boolean {
  if (isWord(element, 'txbxContent') ||
    element.tag.uri === 'urn:schemas-microsoft-com:vml' && element.tag.local === 'textbox' ||
    drawingNamespaces.has(element.tag.uri) && element.tag.local === 't' && !!element.text) {
    return true
  }
  return element.children.some(containsTextBox)
}

function checkMaterialContent(element: XmlElement) {
  if (isWord(element)) {
    const name = element.tag.local
    if (unsupportedRevisions.test(name)) {
      throw new Error('The DOCX contains tracked changes whose visible content cannot be imported reliably.')
    }
    if (['fldSimple', 'fldChar', 'instrText', 'delInstrText'].includes(name)) {
      throw new Error('The DOCX contains fields whose displayed content cannot be imported reliably.')
    }
    if (['sdt', 'altChunk', 'subDoc', 'customXml'].includes(name)) {
      throw new Error('The DOCX contains content controls or alternate content whose visible content cannot be imported reliably.')
    }
    if (name === 'documentProtection' || name === 'writeProtection') {
      throw new Error('Protected DOCX documents are unsupported.')
    }
    if (name === 'object' || name === 'drawing' || name === 'pict') return
  }
  for (const child of element.children) checkMaterialContent(child)
}

function block(type: string, content: JSONContent[]): JSONContent {
  return { type, ...(content.length ? { content } : {}) }
}

function preservedBody(content: JSONContent[]): DocxIssue {
  const counts = new Map<string, number>()
  for (const node of content) {
    if (node.type) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  }
  const labels = [
    ['paragraph', 'paragraph'], ['heading', 'heading'], ['orderedList', 'ordered list'],
    ['bulletList', 'bulleted list'], ['table', 'table'],
  ]
  const descriptions: string[] = []
  for (const [type, label] of labels) {
    const count = counts.get(type)
    if (count) descriptions.push(`${count} ${label}${count === 1 ? '' : 's'}`)
  }
  return {
    code: 'body-content',
    feature: 'Document body',
    location: 'Document body',
    effect: 'preserved',
    message: `Preserved ${new Intl.ListFormat('en').format(descriptions)}.`,
  }
}

export function readDocx(bytes: Uint8Array<ArrayBuffer>): { document: JSONContent; issues: DocxIssue[] } {
  const source = readPackage(bytes)
  const { main, mainRelationships, rootRelationships, xml } = source
  const issues: DocxIssue[] = []
  const seen = new Set<string>()
  function issue(code: string, feature: string, location: string, effect: 'approximated' | 'omitted', message: string) {
    const key = `${code}\n${location}`
    if (seen.has(key)) return
    if (seen.size >= 5000) throw new Error('The DOCX exceeds the limit for unsupported features.')
    seen.add(key)
    issues.push({ code, feature, location, effect, message })
  }
  function omit([code, feature]: [string, string], location: string) {
    issue(code, feature, location, 'omitted', `${feature} will be left out of the editable copy.`)
  }
  function approximate(code: string, feature: string, location: string, message: string) {
    issue(code, feature, location, 'approximated', message)
  }
  function relationshipIssues(relationships: Map<string, Relationship>, part: string) {
    for (const relation of relationships.values()) {
      const { kind, external, id } = relation
      const location = `${part} relationship ${id}`
      if (kind === 'officeDocument' || kind === 'hyperlink' || mainDefinitionRelationships.has(kind)) continue
      if (Object.hasOwn(relationshipLosses, kind)) {
        omit(relationshipLosses[kind], location)
      } else if (['theme', 'fontTable', 'stylesWithEffects'].includes(kind)) {
        approximate('theme-fonts', 'Theme and fonts', location, 'The editable copy uses Folio’s theme and fonts.')
      } else if (kind === 'webSettings' && !external) {
        continue
      } else {
        omit(['relationships', external ? 'External relationships' : 'Unsupported package relationships'], location)
      }
    }
  }
  if (rootRelationships) relationshipIssues(rootRelationships, 'Package')
  relationshipIssues(mainRelationships, 'Document')

  function definition(kind: string) {
    const part = relatedPart(mainRelationships, kind)
    const root = part ? xml(part) : undefined
    if (root) checkMaterialContent(root)
    return root
  }
  const settings = definition('settings')
  if (settings && !isWord(settings, 'settings')) throw new Error('Invalid DOCX settings part.')
  const styles = readStyles(definition('styles'))
  const numbering = readNumbering(definition('numbering'))
  const root = xml(main)
  checkMaterialContent(root)
  const body = wordChild(root, 'body')
  if (!isWord(root, 'document') || !body) throw new Error('Invalid Word DOCX main document.')
  requireContainer(root, 'Document')
  requireContainer(body, 'Document body')
  for (const element of root.children) {
    if (element === body) continue
    if (!isWord(element, 'background')) unsupported(element, 'Document')
    approximate('page-background', 'Page background', 'Document', 'The page background is reset in the editable copy.')
  }

  function section(element: XmlElement, location: string) {
    requireContainer(element, location)
    const layout = element.children.some(child => !isWord(child, 'headerReference') && !isWord(child, 'footerReference'))
    if (layout) approximate('page-layout', 'Page layout', location, 'Margins, section breaks, and pagination use defaults in the editable copy.')
    for (const child of element.children) {
      if (isWord(child, 'headerReference')) omit(relationshipLosses.header, location)
      if (isWord(child, 'footerReference')) omit(relationshipLosses.footer, location)
    }
  }

  function inlineOmitted(element: XmlElement, location: string) {
    if (isWord(element) && Object.hasOwn(inlineLosses, element.tag.local)) {
      if (['drawing', 'pict', 'object'].includes(element.tag.local) && containsTextBox(element)) {
        throw new Error(`The DOCX contains a drawing or text box at ${location} whose visible text cannot be imported reliably.`)
      }
      omit(inlineLosses[element.tag.local], location)
      return true
    }
    if (mathNamespaces.has(element.tag.uri) && ['oMath', 'oMathPara'].includes(element.tag.local)) {
      omit(['equations', 'Equations'], location)
      return true
    }
    return false
  }

  function run(element: XmlElement, location: string, result: JSONContent[], link?: Mark) {
    requireContainer(element, location)
    const properties = wordChild(element, 'rPr')
    rejectHiddenProperties(properties)
    const marks: Mark[] = []
    if (properties) {
      requireContainer(properties, location)
      const bold = wordChild(properties, 'b')
      const italic = wordChild(properties, 'i')
      const underline = wordChild(properties, 'u')
      const boldActive = bold && enabled(bold)
      const italicActive = italic && enabled(italic)
      if (boldActive) marks.push({ type: 'bold' })
      if (italicActive) marks.push({ type: 'italic' })
      if (underline && wordAttr(underline) !== 'none') marks.push({ type: 'underline' })
      const runStyle = wordChild(properties, 'rStyle')
      const style = runStyle && wordAttr(runStyle)
      if (style) styles.checkCharacter(style)
      const custom = properties.children.some(child => {
        if (!isWord(child)) return true
        switch (child.tag.local) {
          case 'bCs': return enabled(child) !== boldActive
          case 'iCs': return enabled(child) !== italicActive
          case 'rStyle': return !(style === 'Hyperlink' && link || style === 'DefaultParagraphFont')
          default: return !['b', 'i', 'u'].includes(child.tag.local) && !passiveRunMetadata.has(child.tag.local)
        }
      })
      if (custom || (underline && (
        !['single', 'none'].includes(wordAttr(underline) ?? 'single') ||
        Object.values(underline.tag.attributes).some(attr => attr.local !== 'val' && attr.prefix !== 'xmlns')
      ))) {
        approximate('run-formatting', 'Text formatting', location, 'Some fonts, colors, underlines or character styles use Folio defaults.')
      }
    }
    if (link) marks.push(link)
    const formatting = marks.length ? { marks } : {}
    let tail: JSONContent | undefined
    function text(value: string) {
      if (tail) {
        tail.text += value
      } else {
        tail = { type: 'text', text: value, ...formatting }
        result.push(tail)
      }
    }
    function lineBreak() {
      result.push({ type: 'hardBreak', ...formatting })
      tail = undefined
    }
    for (const child of element.children) {
      if (child === properties || isWord(child, 'lastRenderedPageBreak') || isWord(child, 'proofErr')) continue
      if (inlineOmitted(child, location)) continue
      if (!isWord(child) || child.children.length) unsupported(child, location)
      switch (child.tag.local) {
        case 't':
          if (child.text) text(child.text)
          break
        case 'br':
          if (wordAttr(child, 'clear') || !['textWrapping', undefined].includes(wordAttr(child, 'type'))) {
            approximate('line-break', 'Page and column breaks', location, 'A page or column break is shown as a line break.')
          }
          lineBreak()
          break
        case 'cr':
          lineBreak()
          break
        case 'tab':
          text('\t')
          break
        case 'noBreakHyphen':
          text('\u2011')
          break
        case 'softHyphen':
          text('\u00ad')
          break
        default:
          unsupported(child, location)
      }
      if (child.tag.local !== 't') requireContainer(child, location)
    }
  }

  function hyperlink(element: XmlElement, location: string, result: JSONContent[]) {
    requireContainer(element, location)
    const id = relationshipAttribute(element, 'id')
    const relationship = id && mainRelationships.get(id)
    const anchor = wordAttr(element, 'anchor')
    let address = relationship && relationship.kind === 'hyperlink' && relationship.external &&
      !wordAttr(element, 'docLocation') ? relationship.target : undefined
    let conflictingFragment = false
    // Word can store an HTTP(S) fragment in w:anchor instead of the external relationship target.
    if (address && anchor) {
      const hash = address.indexOf('#')
      conflictingFragment = hash >= 0 && address.slice(hash + 1) !== anchor
      if (!/^https?:/i.test(address) || conflictingFragment) address = undefined
      else if (hash < 0) address += `#${anchor}`
    }
    const link = address && safeDocxLink(address) ? { type: 'link', attrs: { href: address } } : undefined
    if (conflictingFragment) {
      issue('hyperlink-fragment', 'Hyperlinks', location, 'omitted', 'A hyperlink with conflicting fragments was removed. Its text is retained.')
    } else if (!link) {
      issue('hyperlinks', 'Hyperlinks', location, 'omitted', 'An unsafe, unavailable or internal link was removed. Its text is retained.')
    }
    for (const child of element.children) {
      if (isWord(child, 'r')) run(child, location, result, link)
      else if (!isWord(child, 'proofErr') && !inlineOmitted(child, location)) unsupported(child, location)
    }
  }

  function paragraph(element: XmlElement, location: string, tableCell = false) {
    requireContainer(element, location)
    const properties = wordChild(element, 'pPr')
    rejectHiddenProperties(properties)
    const style = properties && wordChild(properties, 'pStyle')
    const styleId = style && wordAttr(style)
    const styleHeading = styles.heading(styleId)
    const outline = properties && wordChild(properties, 'outlineLvl')
    const outlineLevel = outline && wordAttr(outline)
    if (outline && (outlineLevel === undefined || !/^[0-9]$/.test(outlineLevel))) {
      throw new Error('The DOCX has an invalid paragraph outline level.')
    }
    const heading = outlineLevel === '9' ? undefined : outlineLevel === undefined ? styleHeading : Number(outlineLevel) + 1
    const headingPreserved = !tableCell && !!heading && heading <= 6
    if (heading && !headingPreserved || styleId && !/^normal$/i.test(styleId) && !headingPreserved ||
      properties?.children.some(child => !isWord(child) || !['pStyle', 'outlineLvl', 'numPr', 'sectPr'].includes(child.tag.local))) {
      approximate('paragraph-formatting', 'Paragraph formatting', location, 'Custom paragraph styles or layout use Folio defaults.')
    }
    const sectPr = properties && wordChild(properties, 'sectPr')
    if (sectPr) section(sectPr, location)
    const numPr = properties && wordChild(properties, 'numPr')
    const numId = numPr && wordChild(numPr, 'numId')
    const number = numId && wordAttr(numId)
    const listId = number === '0' ? undefined : number
    if (numPr && (number === undefined || !/^\d{1,10}$/.test(number) ||
      numPr.children.some(child => !isWord(child) || !['ilvl', 'numId'].includes(child.tag.local)))) {
      throw new Error('The DOCX has advanced or ambiguous list numbering.')
    }
    if (numPr && listId) {
      const level = wordChild(numPr, 'ilvl')
      if (tableCell || headingPreserved || (level && wordAttr(level) !== '0')) {
        throw new Error('The DOCX has complex lists outside the supported single-level paragraph subset.')
      }
    }
    const content: JSONContent[] = []
    for (const child of element.children) {
      if (child === properties || isWord(child, 'proofErr')) continue
      if (isWord(child, 'r')) run(child, location, content)
      else if (isWord(child, 'hyperlink')) hyperlink(child, location, content)
      else if (!inlineOmitted(child, location)) unsupported(child, location)
    }
    const node = block(headingPreserved ? 'heading' : 'paragraph', content)
    if (headingPreserved) node.attrs = { level: heading }
    return { node, listId }
  }

  function table(element: XmlElement, location: string): JSONContent {
    const complex = () => { throw new Error(`The DOCX has a merged, nested, or complex table at ${location}.`) }
    requireContainer(element, location)
    const properties = wordChild(element, 'tblPr')
    const styleTag = properties && wordChild(properties, 'tblStyle')
    const style = styleTag && wordAttr(styleTag)
    if (style) styles.checkTable(style)
    const width = properties && wordChild(properties, 'tblW')
    const borders = properties && wordChild(properties, 'tblBorders')
    const grid = wordChild(element, 'tblGrid')
    const gridColumns = grid ? wordChildren(grid, 'gridCol') : undefined
    const customBorders = borders?.children.some(border => !isWord(border) || wordAttr(border) !== 'single' ||
      !['4', undefined].includes(wordAttr(border, 'sz')) || !['auto', undefined].includes(wordAttr(border, 'color')))
    if ((style && !['TableGrid', 'FolioTableGrid', 'TableNormal'].includes(style)) ||
      (width && wordAttr(width, 'type') !== 'auto') || customBorders ||
      gridColumns?.some(column => wordAttr(column, 'w') !== undefined) || properties?.children.some(child => (
        !isWord(child) || !['tblStyle', 'tblW', 'tblBorders'].includes(child.tag.local)
      ))) {
      approximate('table-formatting', 'Table formatting', location, 'Table widths and styling use Folio defaults.')
    }
    const rows = wordChildren(element, 'tr')
    if (!rows.length || grid && grid.children.length !== gridColumns?.length ||
      element.children.some(child => child !== properties && child !== grid && !isWord(child, 'tr'))) return complex()
    let columnCount = gridColumns?.length
    return block('table', rows.map((row, rowIndex) => {
      requireContainer(row, location)
      const rowProperties = wordChild(row, 'trPr')
      const exception = wordChild(row, 'tblPrEx')
      if (rowProperties?.children.some(child => isWord(child, 'gridBefore') || isWord(child, 'gridAfter'))) return complex()
      const headerTag = rowProperties && wordChild(rowProperties, 'tblHeader')
      const header = headerTag && enabled(headerTag)
      if (header && rowIndex || exception || rowProperties?.children.some(child => !isWord(child, 'tblHeader'))) {
        approximate('table-row-formatting', 'Table row formatting', location, 'Only the first table row can be a header. Row layout uses defaults.')
      }
      const cells = wordChildren(row, 'tc')
      if (!cells.length || row.children.some(child => child !== rowProperties && child !== exception && !isWord(child, 'tc'))) return complex()
      columnCount ??= cells.length
      if (cells.length !== columnCount || cells.length > 63) return complex()
      return block('tableRow', cells.map((cell, cellIndex) => {
        requireContainer(cell, location)
        const cellProperties = wordChild(cell, 'tcPr')
        const span = cellProperties && wordChild(cellProperties, 'gridSpan')
        if (cellProperties && (wordChild(cellProperties, 'vMerge') || wordChild(cellProperties, 'hMerge') ||
          (span && wordAttr(span) !== '1'))) return complex()
        const cellWidth = cellProperties && wordChild(cellProperties, 'tcW')
        if (cellWidth && wordAttr(cellWidth, 'type') !== 'auto' ||
          cellProperties?.children.some(child => !isWord(child) || !['gridSpan', 'tcW'].includes(child.tag.local))) {
          approximate('table-cell-formatting', 'Table cell formatting', location, 'Table cell formatting uses Folio defaults.')
        }
        const paragraphs = wordChildren(cell, 'p')
        if (!paragraphs.length || cell.children.some(child => child !== cellProperties && !isWord(child, 'p'))) return complex()
        const cellLocation = `${location}, row ${rowIndex + 1}, cell ${cellIndex + 1}`
        return block(header && rowIndex === 0 ? 'tableHeader' : 'tableCell',
          paragraphs.map((item, index) => paragraph(item, `${cellLocation}, paragraph ${index + 1}`, true).node))
      }))
    }))
  }

  let paragraphIndex = 0
  let tableIndex = 0
  let activeList: { id: string; node: JSONContent } | undefined
  const counters = new Map<string, number>()
  const content: JSONContent[] = []
  const finalSection = wordChild(body, 'sectPr')
  for (const [position, child] of body.children.entries()) {
    if (isWord(child, 'p')) {
      const location = `Paragraph ${++paragraphIndex}`
      const { node, listId } = paragraph(child, location)
      if (!listId) {
        content.push(node)
        activeList = undefined
        continue
      }
      const definition = numbering(listId)
      if (definition.approximate) {
        approximate('numbering-format', 'List numbering format', location, 'List marker appearance uses Folio defaults.')
      }
      const next = counters.get(listId) ?? definition.start
      if (activeList?.id !== listId) {
        const list: JSONContent = { type: definition.type, content: [] }
        if (definition.type === 'orderedList') list.attrs = { start: next }
        content.push(list)
        activeList = { id: listId, node: list }
      }
      counters.set(listId, next + 1)
      activeList.node.content!.push(block('listItem', [node]))
    } else {
      activeList = undefined
      if (isWord(child, 'tbl')) content.push(table(child, `Table ${++tableIndex}`))
      else if (child === finalSection && position === body.children.length - 1) section(child, 'Section properties')
      else if (!inlineOmitted(child, `Body item ${position + 1}`)) unsupported(child, `Body item ${position + 1}`)
    }
  }
  const document = canonicalDocx(block('doc', content.length ? content : [{ type: 'paragraph' }]))
  source.verifyRemaining()
  if (content.length) issues.push(preservedBody(content))
  return { document, issues }
}
