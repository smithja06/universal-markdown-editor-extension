export interface SearchOptions { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export interface MatchRange { from: number; to: number }
export interface TextMatch extends MatchRange {
  segment: number
  text: string
  captures?: (string | undefined)[]
  groups?: Record<string, string | undefined>
}

const wordCharacter = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]'
const beforeWord = new RegExp(wordCharacter + '$', 'u')
const afterWord = new RegExp('^' + wordCharacter, 'u')

export function findTextMatches(texts: readonly string[], term: string, options: SearchOptions): TextMatch[] {
  if (!term) return []
  const pattern = options.regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(pattern, options.caseSensitive ? 'gmu' : 'gimu')
  const matches: TextMatch[] = []
  for (const [segment, text] of texts.entries()) {
    for (const result of text.matchAll(expression)) {
      if (!result[0]) continue
      const from = result.index
      const to = from + result[0].length
      if (options.wholeWord && (beforeWord.test(text.slice(Math.max(0, from - 2), from)) || afterWord.test(text.slice(to, to + 2)))) continue
      const match = { segment, from, to, text: result[0] }
      matches.push(options.regex ? { ...match, captures: result.slice(1), groups: result.groups } : match)
    }
  }
  return matches
}

export function replacementText(value: string, match: TextMatch, regex: boolean) {
  if (!regex) return value
  return value.replace(/\$([$&]|[1-9][0-9]?|<[^>]+>)/g, (literal, token: string) => {
    if (token === '$') return '$'
    if (token === '&') return match.text
    if (token.startsWith('<')) return match.groups ? match.groups[token.slice(1, -1)] ?? '' : literal
    const index = Number(token) - 1
    if (index < (match.captures?.length ?? 0)) return match.captures?.[index] ?? ''
    if (token.length === 2 && Number(token[0]) <= (match.captures?.length ?? 0)) return (match.captures?.[Number(token[0]) - 1] ?? '') + token[1]
    return literal
  })
}
