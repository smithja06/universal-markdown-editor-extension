import { Model } from '@ironcalc/wasm-xlsx'
import { zipSync } from 'fflate'
import { cellAddress, createSheet, parseAddress, parseRange, rangeSize, safeSpreadsheetLink, spreadsheetLimits, type Cell, type CellValue, type Sheet, type Workbook } from './model'
import { conditionalRules, decodeStyle, isDateFormat } from './xlsxStyles'
import { readCoreProperties, readRegionalProperties } from './xlsxMetadata'
import { formulaCatalog } from './formulaCatalog'
import { child, children, isTrue, relations, relationshipPath, sheetNamespace, spreadsheetZip, writeRelations, xmlBytes, xmlReader, type Relation, type XmlNode } from './xlsxXml'

const unsupportedParts: [RegExp, string][] = [
  [/(?:^|\/)(?:charts|drawings|media)\//, 'Charts, drawings and embedded images are omitted from the edited copy.'],
  [/(?:^|\/)pivot(?:tables|cache)\//, 'Pivot tables and pivot caches are omitted from the edited copy.'],
  [/(?:^|\/)(?:externallinks|querytables)\/|\/connections\.xml$/, 'External workbook links and data connections are omitted and never opened.'],
  [/(?:^|\/)(?:tables|slicers|slicercaches)\//, 'Structured tables, slicers and their metadata are omitted from the edited copy.'],
  [/(?:^|\/)(?:threadedcomments|comments)\/|\/comments\d*\.xml$/, 'Comments and notes are omitted from the edited copy.'],
  [/^customxml\//, 'Custom XML parts are omitted from the edited copy.'],
]
const macroPart = /(?:vba(?:project|data)|activex|macrosheet|oleobject|embeddings\/)/i
const maxMetadataEntries = 40_000
const maxMerges = 2_000
const localFunctions = new Set<string>(formulaCatalog.map(item => item.name))
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
// Exclude control characters other than XML whitespace allowed by the parser.
// eslint-disable-next-line no-control-regex
const supportedFormulaConstruct = /^[^\u0000-\u0008\u000b-\u001f\u007f]*$/

function integer(value: string | undefined, max: number, label: string, min = 1) {
  if (!value || !/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`An XLSX ${label} is out of bounds.`)
  return Number(value)
}

function xmlSheet(node: XmlNode, tag: string) {
  if (node.namespace !== sheetNamespace || node.local !== tag) throw new Error(`Invalid or unsupported XLSX ${tag} markup.`)
  return node
}

function styleAndValue(model: Model, sheet: number, cell: XmlNode, row: number, col: number, warnings: Set<string>): Cell {
  const formula = child(cell, 'f')
  const raw = child(cell, 'v')?.text
  const type = cell.attrs.t ?? 'n'
  const style = Number(cell.attrs.s) > 0 ? decodeStyle(model, model.getCellStyle(sheet, row, col).style, warnings) : undefined
  const formatted = () => model.getFormattedCellValue(sheet, row, col)
  if (formula) {
    let cached: CellValue | undefined
    if (raw !== undefined && raw !== '') {
      if (type === 'b' && (raw === '1' || raw === '0')) cached = raw === '1'
      else if (type === 'n' && number.test(raw) && Number.isFinite(Number(raw))) cached = Number(raw)
      else if (type === 'str' || type === 'e') cached = raw
      else warnings.add('Some imported formula caches use an unsupported representation and are omitted.')
    } else if (type === 'str' && raw === '') cached = ''
    const expression = formula.text ? '=' + formula.text : model.getCellContent(sheet, row, col)
    if (!expression.startsWith('=')) throw new Error('An XLSX shared formula could not be resolved safely.')
    if (formula.attrs.t === 'array' || formula.attrs.t === 'dataTable' || cell.attrs.cm || cell.attrs.vm) {
      warnings.add('Array, spill and data-table formula structures are omitted. Formula text and recognized cached values are retained.')
    }
    const expressionOutsideLiterals = expression.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '')
    const usesUnqualifiedFunctions = [...expressionOutsideLiterals.matchAll(/\b([A-Z][\w.]*)\s*\(/gi)].some(match => !localFunctions.has(match[1].toUpperCase()))
    if (/\[[^\]]*\]/.test(expressionOutsideLiterals) || usesUnqualifiedFunctions) {
      warnings.add('Some formulas use external, structured or unqualified features. Their text is preserved and Folio calculation may be unavailable.')
    }
    warnings.add('Imported formulas show stored results when available. Results may be stale until you explicitly calculate.')
    return { kind: 'formula', value: expression, ...(cached === undefined ? {} : { cached }),
      ...(cached !== undefined && type === 'e' ? { cachedError: true } : {}), ...(style ? { style } : {}) }
  }
  let kind: Cell['kind'] = 'text'
  let value: CellValue = ''
  switch (type) {
    case 's':
    case 'inlineStr': value = formatted(); break
    case 'str': value = raw ?? ''; break
    case 'b':
      if (raw !== '0' && raw !== '1') throw new Error('An XLSX Boolean has an invalid value.')
      kind = 'boolean'; value = raw === '1'; break
    case 'e':
      if (raw && !/^#[A-Z0-9/_]+[!?]?$/i.test(raw)) throw new Error('An XLSX error cell contains an invalid token.')
      kind = 'error'; value = raw ?? '#VALUE!'; break
    case 'd':
      if (!raw || !/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(raw)) throw new Error('An XLSX date has an invalid value.')
      kind = 'date'; value = raw; break
    case 'n':
      if (raw !== undefined && raw !== '') {
        if (!number.test(raw) || !Number.isFinite(Number(raw))) throw new Error('An XLSX number has an invalid value.')
        kind = isDateFormat(style?.numberFormat) ? 'date' : 'number'
        value = Number(raw)
      }
      break
    default: throw new Error('An XLSX cell uses an unsupported value type.')
  }
  return { kind, value, ...(style ? { style } : {}) }
}

function scanFormula(formula: XmlNode | undefined, limit: { formulas: number }) {
  if (!formula) return
  if (++limit.formulas > 40_000 || formula.text.length > 8192 || !supportedFormulaConstruct.test(formula.text)) {
    throw new Error('The workbook exceeds XLSX formula limits.')
  }
  // Rust parses source expressions on load even when Folio never evaluates them.
  // Bound parser nesting and total operators for hostile formulas.
  const expression = formula.text.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '')
  const tokens = expression.match(/[()+*/^&<>=\-,;{]/g) ?? []
  if (tokens.length > 384) throw new Error('A workbook formula exceeds the parser complexity limit.')
  if (formula.attrs.t === 'array' && formula.attrs.ref) {
    const range = parseRange(formula.attrs.ref)
    if (!range || rangeSize(range) > spreadsheetLimits.rangeCells) throw new Error('An imported formula array exceeds the size limit.')
  }
}

function dimensions(model: Model, sheet: Sheet, index: number, root: XmlNode, warnings: Set<string>) {
  const defaults = child(root, 'sheetFormatPr')?.attrs
  if (defaults && (defaults.defaultColWidth !== undefined ||
    defaults.defaultRowHeight !== undefined && Number(defaults.defaultRowHeight) !== 15 || isTrue(defaults.zeroHeight))) {
    warnings.add('Some default row or column sizes are approximated in Folio and in the edited copy.')
  }
  let entries = 0
  const hiddenCols: number[] = []
  const hiddenRows: number[] = []
  for (const column of children(child(root, 'cols'), 'col')) {
    const first = integer(column.attrs.min, spreadsheetLimits.cols, 'column')
    const last = integer(column.attrs.max, spreadsheetLimits.cols, 'column', first)
    entries += last - first + 1
    if (entries > maxMetadataEntries) throw new Error('The workbook has too many custom row and column dimensions.')
    for (let col = first; col <= last; col++) {
      if (isTrue(column.attrs.hidden)) hiddenCols.push(col)
      if (column.attrs.width !== undefined) {
        const width = model.getColumnWidth(index, col)
        if (width > 0) sheet.widths[col] = width
      }
    }
    if (column.attrs.style && column.attrs.style !== '0' || column.attrs.outlineLevel) warnings.add('Column-level styles and outline groups are omitted.')
  }
  for (const row of children(child(root, 'sheetData'), 'row')) {
    if (!row.attrs.r) continue
    const indexInSheet = integer(row.attrs.r, spreadsheetLimits.rows, 'row')
    if (row.attrs.ht !== undefined || isTrue(row.attrs.hidden)) {
      if (++entries > maxMetadataEntries) throw new Error('The workbook has too many custom row and column dimensions.')
      if (isTrue(row.attrs.hidden)) hiddenRows.push(indexInSheet)
      if (row.attrs.ht !== undefined) {
        const height = model.getRowHeight(index, indexInSheet)
        if (height > 0) sheet.heights[indexInSheet] = height
      }
    }
    if (row.attrs.s && row.attrs.s !== '0' || row.attrs.outlineLevel) warnings.add('Row-level styles and outline groups are omitted.')
  }
  if (hiddenCols.length) sheet.hiddenCols = [...new Set(hiddenCols)]
  if (hiddenRows.length) sheet.hiddenRows = [...new Set(hiddenRows)]
}

function validateSheetLimits(root: XmlNode, totals: { cells: number; formulas: number }, warnings: Set<string>) {
  const addressSet = new Set<string>()
  for (const row of children(child(root, 'sheetData'), 'row')) {
    for (const cell of children(row, 'c')) {
      if (++totals.cells > spreadsheetLimits.cells) throw new Error('The workbook has too many populated or formatted cells.')
      const address = cell.attrs.r
      if (!address || !parseAddress(address) || addressSet.has(address.toUpperCase())) throw new Error('An XLSX cell has an invalid or duplicate address.')
      addressSet.add(address.toUpperCase())
      if ((child(cell, 'v')?.text.length ?? 0) > spreadsheetLimits.cellLength) throw new Error('A workbook cell exceeds the text length limit.')
      scanFormula(child(cell, 'f'), totals)
    }
  }
  const merges = children(child(root, 'mergeCells'), 'mergeCell')
  if (merges.length > maxMerges) throw new Error('The workbook has too many merged ranges.')
  let mergedArea = 0
  for (const merge of merges) {
    const range = parseRange(merge.attrs.ref ?? '')
    if (!range || rangeSize(range) > spreadsheetLimits.rangeCells) throw new Error('A merged range exceeds the size limit.')
    mergedArea += rangeSize(range)
  }
  if (mergedArea > 200_000) throw new Error('The workbook exceeds the total merged cell limit.')
  const links = children(child(root, 'hyperlinks'), 'hyperlink')
  if (links.length > 10_000 || links.some(link => !parseAddress(link.attrs.ref ?? ''))) throw new Error('The workbook has too many hyperlinks or range-based hyperlinks.')
  if (root.children.some(node => ['dataValidations', 'autoFilter', 'sheetProtection', 'pageSetup', 'drawing', 'legacyDrawing', 'tableParts'].includes(node.local))) {
    warnings.add('Some worksheet metadata, including validation, filtering, protection or print settings, is omitted.')
  }
}

/** Reads supported workbook state while keeping incoming formulas and CF inert. */
export function importXlsx(bytes: Uint8Array<ArrayBuffer>): Workbook {
  if (bytes.length > spreadsheetLimits.fileBytes) throw new Error('XLSX imports are limited to 16 MiB.')
  const zip = spreadsheetZip(bytes)
  zip.verifyRemaining()
  const parseXml = xmlReader()
  const load = (part: string) => parseXml(zip.read(part))
  const names = new Set(zip.names)
  const warnings = new Set<string>()
  if (zip.names.some(name => macroPart.test(name))) throw new Error('Macro-enabled or executable workbook content is unsupported.')
  const types = load('[content_types].xml')
  if (types.children.some(node => /macroenabled|vba|activex|oleobject/i.test(node.attrs.ContentType ?? ''))) {
    throw new Error('Macro-enabled or executable workbook content is unsupported.')
  }
  for (const [pattern, message] of unsupportedParts) if (zip.names.some(name => pattern.test(name))) warnings.add(message)

  const packageRelationships = relations(load('_rels/.rels'), '')
  const office = [...packageRelationships.values()].filter(item => item.type.endsWith('/officeDocument'))
  if (office.length !== 1 || office[0].external) throw new Error('The XLSX workbook part is missing or external.')
  const propertiesPart = (kind: string) => {
    const relation = [...packageRelationships.values()].find(item => item.type.endsWith('/' + kind) && !item.external)
    return relation ? load(relation.target) : undefined
  }
  const coreProperties = readCoreProperties(propertiesPart('core-properties'), warnings)
  const regional = readRegionalProperties(propertiesPart('custom-properties'), warnings)
  const workbookPath = office[0].target
  const workbook = xmlSheet(load(workbookPath), 'workbook')
  const workbookLinks = relations(load(relationshipPath(workbookPath)), workbookPath)
  if ([...workbookLinks.values()].some(item => item.external || /externalLink|connection/i.test(item.type))) {
    warnings.add('External workbook links and data connections are omitted and never opened.')
  }
  const date1904 = isTrue(child(workbook, 'workbookPr')?.attrs.date1904)
  if (children(child(workbook, 'definedNames'), 'definedName').length) warnings.add('Defined names and named print ranges are omitted from the edited copy.')
  if (workbook.children.some(item => ['workbookProtection', 'fileSharing', 'extLst'].includes(item.local))) {
    warnings.add('Workbook protection or vendor-specific workbook metadata is omitted.')
  }
  const sheets = children(child(workbook, 'sheets'), 'sheet')
  if (!sheets.length || sheets.length > spreadsheetLimits.sheets) throw new Error('The workbook sheet count is outside supported limits.')

  const sanitized: Record<string, Uint8Array<ArrayBuffer>> = {}
  const compatibleRelationships: Relation[] = []
  const validSheets: { root: XmlNode; name: string; blocks: XmlNode[] }[] = []
  const totals = { cells: 0, formulas: 0 }
  const usedSheets = new Set<string>()
  for (const sheet of sheets) {
    const relation = workbookLinks.get(sheet.relationship ?? '')
    if (!relation || relation.external) throw new Error('An XLSX worksheet is missing or external.')
    if (!relation.type.endsWith('/worksheet')) {
      warnings.add('Non-worksheet tabs are omitted from the edited copy.')
      continue
    }
    const name = sheet.attrs.name
    if (!name || name.length > 31 || /[\\/?*[\]:\p{Cc}]/u.test(name) || usedSheets.has(name.toLowerCase())) throw new Error('An XLSX worksheet has an invalid or duplicate name.')
    usedSheets.add(name.toLowerCase())
    const root = xmlSheet(load(relation.target), 'worksheet')
    validateSheetLimits(root, totals, warnings)
    const blocks = children(root, 'conditionalFormatting')
    const extensions = children(root, 'extLst')
    if (extensions.some(item => item.children.some(extension => extension.attrs.uri !== '{78C0D931-6437-407d-A8EE-F0AAD7539E65}'))) {
      warnings.add('Extended worksheet and conditional formatting metadata is omitted.')
    }
    root.children = root.children.filter(item => !['conditionalFormatting', 'extLst', 'tableParts', 'legacyDrawing', 'drawing', 'oleObjects', 'controls'].includes(item.local))
    const target = `xl/worksheets/sheet${validSheets.length + 1}.xml`
    const linksPath = relationshipPath(relation.target)
    const links = names.has(linksPath) ? [...relations(load(linksPath), relation.target).values()].filter(item => item.external && item.type.endsWith('/hyperlink') && safeSpreadsheetLink(item.target)) : []
    const acceptedLinks = new Set(links.map(item => item.id))
    const hyperlinks = child(root, 'hyperlinks')
    if (hyperlinks) {
      if (hyperlinks.children.some(item => !acceptedLinks.has(item.relationship ?? '') || item.attrs.tooltip)) warnings.add('Internal, unsafe or customized hyperlink details are omitted.')
      hyperlinks.children = hyperlinks.children.filter(item => acceptedLinks.has(item.relationship ?? ''))
    }
    if (links.length) sanitized[relationshipPath(target)] = writeRelations(links)
    if (sheet.attrs.state && sheet.attrs.state !== 'visible') warnings.add('Hidden worksheets are shown in Folio and in the edited copy.')
    validSheets.push({ root, name, blocks })
    compatibleRelationships.push({ ...relation, target })
    sanitized[target] = xmlBytes(root)
  }
  if (!validSheets.length) throw new Error('The workbook has no supported worksheets.')
  const sheetList = child(workbook, 'sheets')!
  const usedIds = new Set(compatibleRelationships.map(item => item.id))
  sheetList.children = sheetList.children.filter(item => usedIds.has(item.relationship ?? ''))
  workbook.children = workbook.children.filter(item => ['sheets', 'bookViews', 'workbookPr', 'calcPr'].includes(item.local))
  sanitized['xl/workbook.xml'] = xmlBytes(workbook)
  let styleSheet: XmlNode | undefined
  for (const [type, target] of [['sharedStrings', 'xl/sharedStrings.xml'], ['styles', 'xl/styles.xml'], ['theme', 'xl/theme/theme1.xml']]) {
    const relation = [...workbookLinks.values()].find(item => item.type.endsWith('/' + type) && !item.external)
    if (!relation) continue
    const root = load(relation.target)
    if (type === 'styles') styleSheet = xmlSheet(root, 'styleSheet')
    if (type === 'sharedStrings' && root.children.some(item => item.children.some(part => part.local === 'r' || part.local === 'rPh'))) {
      warnings.add('Rich and phonetic cell text is converted to plain text.')
    }
    // Use the original validated text here to preserve mixed XML text order.
    sanitized[target] = zip.read(relation.target)
    compatibleRelationships.push({ ...relation, target })
  }
  sanitized['xl/_rels/workbook.xml.rels'] = writeRelations(compatibleRelationships)
  const model = Model.fromXlsx(zipSync(sanitized, { level: 0 }), 'Workbook', 'en', 'UTC', 'en')
  try {
    const props = model.getWorksheetsProperties()
    if (props.length !== validSheets.length || props.some((item, index) => item.name !== validSheets[index].name)) {
      throw new Error('IronCalc could not preserve the workbook worksheet order.')
    }
    let expandedCellCharacters = 0
    const imported = validSheets.map(({ root, name, blocks }, index) => {
      const sheet = createSheet(name)
      sheet.frozenRows = model.getFrozenRowsCount(index)
      sheet.frozenCols = model.getFrozenColumnsCount(index)
      sheet.gridLines = model.getShowGridLines(index)
      sheet.merges = model.getMergedCells(index).map(({ row, column, width, height }) => ({ row, col: column, endRow: row + height - 1, endCol: column + width - 1 }))
      sheet.rules = conditionalRules(model, blocks, styleSheet, warnings)
      dimensions(model, sheet, index, root, warnings)
      for (const row of children(child(root, 'sheetData'), 'row')) for (const cellNode of children(row, 'c')) {
        const position = parseAddress(cellNode.attrs.r)!
        const cell = styleAndValue(model, index, cellNode, position.row, position.col, warnings)
        expandedCellCharacters += String(cell.value).length + String(cell.cached ?? '').length +
          (cell.style?.font?.length ?? 0) + (cell.style?.numberFormat?.length ?? 0)
        if (expandedCellCharacters > 16_000_000) throw new Error('Expanded workbook cell contents exceed the size limit.')
        if (cell.kind === 'text' && typeof cell.value === 'string' && cell.value.length > spreadsheetLimits.cellLength) {
          throw new Error('A workbook cell exceeds the text length limit.')
        }
        if (cell.value !== '' || cell.style) sheet.cells[cellAddress(position.row, position.col)] = cell
      }
      for (const link of model.getLinks(index)) {
        const target = link.type === 'External' && !link.dynamic ? safeSpreadsheetLink(link.target) : undefined
        if (target) {
          expandedCellCharacters += target.length
          if (expandedCellCharacters > 16_000_000) throw new Error('Expanded workbook cell contents exceed the size limit.')
          const address = cellAddress(link.row, link.column)
          const cell = sheet.cells[address]
          sheet.cells[address] = cell ? { ...cell, link: target } : { kind: 'text', value: '', link: target }
        }
      }
      return sheet
    })
    return { sheets: imported, date1904, imported: true, warnings: [...warnings], ...regional, ...(coreProperties ? { coreProperties } : {}) }
  } finally { model.free() }
}
