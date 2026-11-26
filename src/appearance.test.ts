import { expect, it } from 'vitest'
import { forestAccent, normalizeColorPreferences, sameColorPreferences } from './appearance'
import { normalizeAppearance } from './document/workspace'

it('defaults shared color preferences to the host theme and rejects malformed values', () => {
  expect(normalizeColorPreferences(undefined)).toEqual({ hostColors: true, theme: 'light', accentColor: forestAccent })
  expect(normalizeColorPreferences({ hostColors: 'no', theme: 'sepia', accentColor: { red: 999, green: -4, blue: 12.6 } }))
    .toEqual({ hostColors: true, theme: 'light', accentColor: { red: 255, green: 0, blue: 13 } })
  const dark = normalizeColorPreferences({ hostColors: false, theme: 'dark', accentColor: { red: 1, green: 2, blue: 3 } })
  expect(dark).toEqual({ hostColors: false, theme: 'dark', accentColor: { red: 1, green: 2, blue: 3 } })
  expect(sameColorPreferences(dark, { ...dark, accentColor: { red: 1, green: 2, blue: 3 } })).toBe(true)
  expect(sameColorPreferences(dark, { ...dark, accentColor: { red: 1, green: 2, blue: 4 } })).toBe(false)
})

it('keeps host colors unless an appearance explicitly opts out', () => {
  expect(normalizeAppearance({}).hostColors).toBe(true)
  expect(normalizeAppearance({ hostColors: false }).hostColors).toBe(false)
  expect(normalizeAppearance({ hostColors: 0 }).hostColors).toBe(true)
})
