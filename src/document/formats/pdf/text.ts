export interface PdfTextSource { str: string; hasEOL?: boolean }

/** The embedded text of one page in pdf.js item order. Offsets are UTF-16 code units. */
export interface PdfPageText {
  page: number
  text: string
  /** Start offset of each text item. The index matches pdf.js text layer spans. */
  starts: number[]
  lengths: number[]
  truncated: boolean
}

export interface PdfMatch { page: number; start: number; end: number }
export interface PdfItemRange { item: number; from: number; to: number }

export function pageText(page: number, items: readonly (PdfTextSource | object)[], limit: number): PdfPageText {
  let text = ''
  const starts: number[] = []
  const lengths: number[] = []
  let truncated = false
  for (const item of items) {
    if (!('str' in item)) continue
    const str = truncated ? '' : item.str.slice(0, Math.max(0, limit - text.length))
    if (str.length < item.str.length) truncated = true
    starts.push(text.length)
    lengths.push(str.length)
    text += str
    if (item.hasEOL && !truncated) text += '\n'
  }
  return { page, text, starts, lengths, truncated }
}

export function hasText(page: PdfPageText) {
  return /\S/u.test(page.text)
}

interface Folded { value: string; map: number[] }

/** Case-folds and collapses whitespace while retaining offsets into the original text. */
function fold(text: string): Folded {
  let value = ''
  const map: number[] = []
  let space = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (/\s/u.test(character)) {
      if (!space && value.length) { value += ' '; map.push(index) }
      space = true
      continue
    }
    space = false
    const lower = character.toLowerCase()
    value += lower.length === 1 ? lower : character
    map.push(index)
  }
  if (value.endsWith(' ')) { value = value.slice(0, -1); map.pop() }
  return { value, map }
}

const foldCache = new WeakMap<PdfPageText, Folded>()

export function normalizedQuery(query: string) {
  return fold(query).value
}

export function findInPage(page: PdfPageText, query: string, limit = 10_000): PdfMatch[] {
  const needle = normalizedQuery(query)
  if (!needle) return []
  let folded = foldCache.get(page)
  if (!folded) { folded = fold(page.text); foldCache.set(page, folded) }
  const matches: PdfMatch[] = []
  for (let index = folded.value.indexOf(needle); index !== -1 && matches.length < limit; index = folded.value.indexOf(needle, index + needle.length)) {
    const start = folded.map[index]
    const end = folded.map[index + needle.length - 1] + 1
    matches.push({ page: page.page, start, end })
  }
  return matches
}

/** Splits a match into ranges of individual text items. */
export function itemRanges(page: PdfPageText, match: Pick<PdfMatch, 'start' | 'end'>): PdfItemRange[] {
  const ranges: PdfItemRange[] = []
  for (let item = 0; item < page.starts.length; item++) {
    const start = page.starts[item]
    const end = start + page.lengths[item]
    if (end <= match.start) continue
    if (start >= match.end) break
    const from = Math.max(match.start, start) - start
    const to = Math.min(match.end, end) - start
    if (to > from) ranges.push({ item, from, to })
  }
  return ranges
}
