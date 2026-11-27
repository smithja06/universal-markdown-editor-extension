import { catalogFunction, formulaArguments, formulaCatalog, type FormulaFunction } from '../../document/formats/spreadsheet/formulaCatalog'

export interface FormulaAssistState {
  /** Matching catalog functions for the name being typed at the cursor. */
  suggestions: FormulaFunction[]
  /** Offset where the typed function name starts. */
  start: number
  /** The innermost supported function call around the cursor and the active argument. */
  call?: { entry: FormulaFunction; argument: number }
  /** Function names in the formula that Folio cannot calculate. */
  unsupported: string[]
}

const nameChar = /[A-Za-z0-9_.]/
const empty: FormulaAssistState = { suggestions: [], start: 0, unsupported: [] }

/** Reads the formula up to the cursor, skipping string literals and quoted sheet names. */
export function formulaAssist(text: string, cursor: number, limit = 8): FormulaAssistState {
  if (!text.startsWith('=') || cursor < 1 || cursor > text.length) return empty
  const calls: { name: string; argument: number }[] = []
  let quote: '"' | "'" | undefined
  for (let index = 1; index < cursor; index++) {
    const char = text[index]
    if (quote) {
      if (char === quote) {
        if (text[index + 1] === quote) index++
        else quote = undefined
      }
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') {
      let start = index
      while (start > 1 && nameChar.test(text[start - 1])) start--
      calls.push({ name: text.slice(start, index).toUpperCase(), argument: 0 })
    } else if (char === ')') calls.pop()
    else if (char === ',' && calls.length) calls[calls.length - 1].argument++
  }
  const unsupported = unsupportedFunctions(text)
  if (quote) return { ...empty, unsupported }
  let start = cursor
  while (start > 1 && nameChar.test(text[start - 1])) start--
  const prefix = text.slice(start, cursor).toUpperCase()
  const previous = text[start - 1]
  const named = /^[A-Z]/.test(prefix) && !/[A-Za-z0-9_.$!:]/.test(previous ?? '') && text[cursor] !== '('
  const suggestions = named
    ? [...formulaCatalog.filter(entry => entry.name.startsWith(prefix)),
      ...formulaCatalog.filter(entry => !entry.name.startsWith(prefix) && entry.name.includes(prefix))].slice(0, limit)
    : []
  const open = [...calls].reverse().find(item => catalogFunction(item.name))
  const entry = open && catalogFunction(open.name)
  return { suggestions, start, unsupported, call: entry && open ? { entry, argument: open.argument } : undefined }
}

/** Inserts the chosen function name and an opening parenthesis, replacing the typed prefix. */
export function applySuggestion(text: string, start: number, cursor: number, name: string) {
  const opened = text[cursor] === '('
  const value = text.slice(0, start) + name + (opened ? '' : '(') + text.slice(cursor)
  return { value, cursor: start + name.length + 1 }
}

export function unsupportedFunctions(text: string) {
  if (!text.startsWith('=')) return []
  const outside = text.replace(/"(?:[^"]|"")*"?|'(?:[^']|'')*'?/g, '')
  const names = [...outside.matchAll(/(?<![A-Za-z0-9_.$])([A-Za-z][A-Za-z0-9_.]*)\s*\(/g)].map(match => match[1].toUpperCase())
  return [...new Set(names.filter(name => !catalogFunction(name)))]
}

/** Splits the documented arguments so the active one can be emphasized. Variadic tails stay on their last label. */
export function argumentHint(entry: FormulaFunction, argument: number) {
  const args = formulaArguments(entry)
  const variadic = args.at(-1) === '…' || /…$/.test(args.at(-1) ?? '')
  const active = args.length === 0 ? -1 : Math.min(argument, variadic ? Math.max(0, args.length - 2) : args.length - 1)
  return { args, active: argument >= args.length && !variadic ? -1 : active }
}
