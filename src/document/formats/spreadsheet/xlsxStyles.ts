import { BorderStyle, type CellStyle as EngineStyle, type CfRuleInput, type Color, type Model } from '@ironcalc/wasm-xlsx'
import { parseRange, rangeAddress, rangeSize, spreadsheetLimits, type Border, type CellStyle, type ConditionalRule } from './model'
import { child, children, isTrue, type XmlNode } from './xlsxXml'

const sides = ['top', 'right', 'bottom', 'left'] as const
const borderKinds = new Map<string, Border['style']>([
  ['thin', 'thin'], ['medium', 'medium'], ['thick', 'thick'], ['double', 'double'], ['dotted', 'dotted'],
  ['mediumdashed', 'dashed'],
])

export function colorValue(model: Model, value: Color) {
  const color = model.resolveColor(value)
  return /^#[a-f\d]{6}$/i.test(color) ? color.toLowerCase() : undefined
}

export function decodeStyle(model: Model, style: EngineStyle, warnings: Set<string>): CellStyle {
  const borders: NonNullable<CellStyle['borders']> = {}
  for (const side of sides) {
    const border = style.border[side]
    if (!border) continue
    const kind = borderKinds.get(border.style)
    if (!kind) warnings.add('Some border patterns are approximated.')
    borders[side] = { color: colorValue(model, border.color) ?? '#000000', style: kind ?? 'thin' }
  }
  if (style.border.diagonal || style.read_only) warnings.add('Diagonal borders or cell protection are omitted from the edited copy.')
  const alignment = style.alignment
  const horizontal = alignment?.horizontal
  const vertical = alignment?.vertical
  if (horizontal && !['left', 'center', 'right', 'general'].includes(horizontal) || vertical && !['top', 'center', 'bottom'].includes(vertical)) {
    warnings.add('Some alignment settings are approximated.')
  }
  if (style.font.name.length > 128 || style.num_fmt.length > 255) {
    warnings.add('Some custom font names or number formats exceed the supported length and are omitted.')
  }
  return {
    ...(style.font.b ? { bold: true } : {}), ...(style.font.i ? { italic: true } : {}),
    ...(style.font.u ? { underline: true } : {}), ...(style.font.strike ? { strike: true } : {}),
    font: style.font.name.length <= 128 ? style.font.name : undefined, size: Math.max(1, Math.min(409, style.font.sz)),
    color: colorValue(model, style.font.color), fill: colorValue(model, style.fill.color),
    horizontal: horizontal === 'left' || horizontal === 'center' || horizontal === 'right' ? horizontal : undefined,
    vertical: vertical === 'center' ? 'middle' : vertical === 'top' || vertical === 'bottom' ? vertical : undefined,
    ...(alignment?.wrap_text ? { wrap: true } : {}),
    ...(style.num_fmt.length <= 255 && style.num_fmt.toLowerCase() !== 'general' ? { numberFormat: style.num_fmt } : {}),
    ...(Object.keys(borders).length ? { borders } : {}),
  }
}

function engineColor(color: string | undefined) {
  return color && /^#[a-f\d]{6}$/i.test(color) ? color.toUpperCase() : undefined
}

export function encodeStyle(style: CellStyle, base: EngineStyle): EngineStyle {
  const border: EngineStyle['border'] = {}
  for (const side of sides) {
    const entry = style.borders?.[side]
    if (!entry) continue
    border[side] = {
      style: entry.style === 'dashed' ? BorderStyle.MediumDashed : entry.style as BorderStyle,
      color: engineColor(entry.color),
    }
  }
  const { horizontal, vertical, wrap } = style
  return {
    ...base,
    num_fmt: style.numberFormat ?? 'general',
    fill: { color: engineColor(style.fill) },
    font: { ...base.font, b: !!style.bold, i: !!style.italic, u: !!style.underline, strike: !!style.strike,
      sz: style.size === undefined ? base.font.sz : Math.max(1, Math.min(409, Math.round(style.size))), color: engineColor(style.color),
      ...(style.font ? { name: style.font, scheme: 'none' } : {}),
    },
    alignment: horizontal || vertical || wrap ? {
      horizontal: horizontal ?? 'general', vertical: vertical === 'middle' ? 'center' : vertical ?? 'bottom', wrap_text: !!wrap,
    } : undefined,
    border,
  }
}

function xmlColor(model: Model, node: XmlNode | undefined) {
  if (!node) return
  const { rgb, theme, tint } = node.attrs
  if (rgb && /^(?:[a-f\d]{2})?[a-f\d]{6}$/i.test(rgb)) return '#' + rgb.slice(-6).toLowerCase()
  if (theme && /^\d{1,2}$/.test(theme) && Number(theme) <= 11 && (!tint || Math.abs(Number(tint)) <= 1)) {
    return colorValue(model, [Number(theme), Number(tint ?? 0)])
  }
}

const fromOperator = { greaterThan: 'greater', lessThan: 'less', equal: 'equal', between: 'between' } as const
const toOperator = { greater: 'GreaterThan', less: 'LessThan', equal: 'Equal', between: 'Between' } as const
const numberConstant = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const isConstant = (value: string | undefined) => !!value && value.length <= 256 && numberConstant.test(value) && Number.isFinite(Number(value))
const isQuoted = (value: string | undefined) => !!value && value.length <= 514 && /^"(?:[^"]|"")*"$/.test(value)

export function conditionalRules(model: Model, blocks: XmlNode[], styleSheet: XmlNode | undefined, warnings: Set<string>): ConditionalRule[] {
  const dxfs = children(child(styleSheet, 'dxfs'), 'dxf')
  const result: { rule: ConditionalRule; priority: number }[] = []
  const unsupported = 'Some conditional formatting rules or differential styles are omitted from the edited copy.'
  for (const block of blocks) for (const node of children(block, 'cfRule')) {
    if (result.length >= 512) { warnings.add(unsupported); break }
    const range = parseRange(block.attrs.sqref ?? '')
    if (!range || rangeSize(range) > spreadsheetLimits.rangeCells || isTrue(node.attrs.stopIfTrue)) { warnings.add(unsupported); continue }
    const dxf = node.attrs.dxfId === undefined ? undefined : dxfs[Number(node.attrs.dxfId)]
    const pattern = child(child(dxf, 'fill'), 'patternFill')
    const fill = xmlColor(model, child(pattern, 'bgColor') ?? child(pattern, 'fgColor'))
    if (dxf?.children.some(item => item.local !== 'fill')) warnings.add(unsupported)
    const id = crypto.randomUUID()
    const base = { id, range, color: fill ?? '#fff2b2' }
    const add = (rule: ConditionalRule) => result.push({ rule, priority: Number(node.attrs.priority) || Number.MAX_SAFE_INTEGER })
    if (node.attrs.type === 'cellIs') {
      const operator = Object.hasOwn(fromOperator, node.attrs.operator) ? fromOperator[node.attrs.operator as keyof typeof fromOperator] : undefined
      const [value, upper] = children(node, 'formula').map(item => item.text)
      const text = operator === 'equal' && isQuoted(value)
      if (operator && (isConstant(value) || text) && (operator !== 'between' || isConstant(upper)) && fill) {
        add({ ...base, operator, value: text ? value.slice(1, -1).replace(/""/g, '"') : value,
          ...(operator === 'equal' ? { valueType: text ? 'text' : 'number' } : {}),
          ...(operator === 'between' ? { upper } : {}) })
        continue
      }
    }
    if (node.attrs.type === 'containsText' && node.attrs.text && node.attrs.text.length <= 256 && fill) {
      add({ ...base, operator: 'contains', value: node.attrs.text })
      continue
    }
    if (node.attrs.type === 'duplicateValues' && fill) {
      add({ ...base, operator: 'duplicate' })
      continue
    }
    const scale = child(node, 'colorScale')
    const bar = child(node, 'dataBar')
    const size = children(scale ?? bar, 'cfvo')
    if (size.length === 2 && size[0].attrs.type === 'min' && size[1].attrs.type === 'max') {
      const [color, color2] = children(scale ?? bar, 'color').map(value => xmlColor(model, value))
      if (scale && color && color2) {
        add({ id, range, operator: 'colorScale', color, color2 })
        continue
      }
      if (bar && color && bar.attrs.showValue !== '0') {
        add({ id, range, operator: 'dataBar', color })
        continue
      }
    }
    warnings.add(unsupported)
  }
  return result.sort((a, b) => a.priority - b.priority).map(item => item.rule)
}

export function addConditionalRule(model: Model, sheet: number, rule: ConditionalRule) {
  const color = engineColor(rule.color)
  if (!color) throw new Error('A conditional rule has an invalid color.')
  const format = { fill: { color } }
  let input: CfRuleInput
  switch (rule.operator) {
    case 'equal': {
      if (rule.value === undefined || rule.value.length > 256 || rule.valueType === 'number' && !isConstant(rule.value)) {
        throw new Error('An equality rule requires a supported comparison value.')
      }
      const formula = rule.valueType !== 'text' && isConstant(rule.value) ? rule.value : '"' + rule.value.replace(/"/g, '""') + '"'
      input = { type: 'CellIs', operator: 'Equal', formula, formula2: null, format, stop_if_true: false }
      break
    }
    case 'greater': case 'less': case 'between':
      if (!isConstant(rule.value) || rule.operator === 'between' && !isConstant(rule.upper)) {
        throw new Error('Conditional comparisons require finite numeric thresholds.')
      }
      input = { type: 'CellIs', operator: toOperator[rule.operator], formula: String(rule.value), formula2: rule.operator === 'between' ? rule.upper ?? null : null, format, stop_if_true: false }
      break
    case 'contains':
      input = { type: 'Text', operator: 'Contains', value: rule.value ?? '', format, stop_if_true: false }
      break
    case 'duplicate':
      input = { type: 'DuplicateValues', format, stop_if_true: false }
      break
    case 'colorScale':
      input = { type: 'ColorScale', thresholds: [{ cfvo: 'Min', color }, { cfvo: 'Max', color: engineColor(rule.color2) ?? '#ffffff' }] }
      break
    case 'dataBar':
      input = { type: 'DataBar', min: 'Min', max: 'Max', positive_color: color, negative_color: '#d65b5b', is_gradient: false, show_value: true }
      break
  }
  model.addConditionalFormatting(sheet, rangeAddress(rule.range), input)
}

export function isDateFormat(pattern: string | undefined) {
  if (!pattern) return false
  const unquoted = pattern.replace(/"[^"]*"|\\.|_.|\*./g, '').replace(/\[(?![hms]+\])[^\]]*\]/gi, '')
  return /[ymdhs]/i.test(unquoted.replace(/general/gi, ''))
}
