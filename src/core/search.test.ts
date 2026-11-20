import { expect, it } from 'vitest'
import { findTextMatches, replacementText } from './search'

const literal = { caseSensitive: false, wholeWord: true, regex: false }

it('matches Unicode words without matching parts of other words', () => {
  const result = findTextMatches(['Cat catfish cat. CAT', 'bécat cat_ cat écat'], 'cat', literal)
  expect(result.map(({ segment, from, text }) => [segment, from, text])).toEqual([[0, 0, 'Cat'], [0, 12, 'cat'], [0, 17, 'CAT'], [1, 11, 'cat']])
})

it('treats a literal query as text and supports regex capture replacements', () => {
  expect(findTextMatches(['x+y xyy'], 'x+y', { ...literal, wholeWord: false })).toHaveLength(1)
  const [match] = findTextMatches(['item 24'], '(?<label>item) (\\d+)', { ...literal, regex: true })
  expect(replacementText('$2: $<label> $$ [$&]', match, true)).toBe('24: item $ [item 24]')
  expect(replacementText('$2', match, false)).toBe('$2')
})

it('rejects invalid patterns and skips zero-width matches', () => {
  expect(() => findTextMatches(['text'], '[', { ...literal, regex: true })).toThrow()
  expect(findTextMatches(['text'], '(?=t)', { ...literal, regex: true })).toEqual([])
})
