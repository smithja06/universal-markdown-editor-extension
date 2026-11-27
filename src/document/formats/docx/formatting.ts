/**
 * Character and paragraph formatting that Folio edits in DOCX and stores in Word's own elements.
 * The model, reader and writer share these conversions so that a write followed by a read is exact.
 */

export interface DocxTextStyle {
  fontFamily?: string
  fontSize?: string
  color?: string
  backgroundColor?: string
}

export type DocxAlignment = 'center' | 'right' | 'justify'

/** Word stores font sizes in half-points. One CSS pixel is 0.75 pt, so one half-point is 1/1.5 px. */
export const docxFontSize = { minHalfPoints: 2, maxHalfPoints: 1638 } as const
/** One indentation step is 24 px, stored as 360 twips. Folio allows up to six steps. */
export const docxIndent = { step: 24, max: 144, twipsPerPixel: 15 } as const

/** The bundled variable font is named differently in CSS and in Word. */
const editorFonts: Record<string, string> = { Inter: 'Inter Variable' }
const wordFonts: Record<string, string> = Object.fromEntries(Object.entries(editorFonts).map(([word, editor]) => [editor, word]))

/** Word's named highlight colors. Other colors are written as run shading. */
export const wordHighlights: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
}

export function highlightName(color: string) {
  return Object.entries(wordHighlights).find(([, value]) => value === color)?.[0]
}

export function halfPointsToPixels(halfPoints: number) {
  return `${Number((halfPoints / 1.5).toFixed(2))}px`
}

export function pixelsToHalfPoints(size: string) {
  return Math.round(Number.parseFloat(size) * 1.5)
}

/** Accepts `#rgb`, `#rrggbb` and `rgb(r, g, b)` and returns lowercase `#rrggbb`. */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const text = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text)
  if (short) return '#' + short.slice(1).map(digit => digit + digit).join('')
  if (/^#[0-9a-f]{6}$/.test(text)) return text
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(text)
  if (rgb && rgb.slice(1).every(part => Number(part) <= 255)) {
    return '#' + rgb.slice(1).map(part => Number(part).toString(16).padStart(2, '0')).join('')
  }
}

/** Returns one font family name, without CSS quotes or fallbacks, or undefined when it cannot be stored. */
export function normalizeFont(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const name = value.split(',')[0].trim().replace(/^(["'])(.*)\1$/, '$2').trim()
  return /^[\p{L}\p{N}][\p{L}\p{N} ._()+-]{0,62}$/u.test(name) && !name.endsWith(' ') ? name : undefined
}

export function normalizeFontSize(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const match = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(value.trim())
  if (!match) return
  const pixels = match[2] === 'pt' ? Number(match[1]) / 0.75 : Number(match[1])
  const halfPoints = Math.round(pixels * 1.5)
  if (halfPoints < docxFontSize.minHalfPoints || halfPoints > docxFontSize.maxHalfPoints) return
  return halfPointsToPixels(halfPoints)
}

/** Keeps the supported text style attributes in a fixed order, or returns undefined when none remain. */
export function normalizeTextStyle(attrs: Record<string, unknown> | undefined): DocxTextStyle | undefined {
  const style: DocxTextStyle = {}
  const fontFamily = normalizeFont(attrs?.fontFamily)
  const fontSize = normalizeFontSize(attrs?.fontSize)
  const color = normalizeColor(attrs?.color)
  const backgroundColor = normalizeColor(attrs?.backgroundColor)
  if (fontFamily) style.fontFamily = fontFamily
  if (fontSize) style.fontSize = fontSize
  if (color) style.color = color
  if (backgroundColor) style.backgroundColor = backgroundColor
  return Object.keys(style).length ? style : undefined
}

export function editorFont(wordFont: string) {
  return editorFonts[wordFont] ?? wordFont
}

export function wordFont(editorFontName: string) {
  return wordFonts[editorFontName] ?? editorFontName
}

export function normalizeAlignment(value: unknown): DocxAlignment | undefined {
  return value === 'center' || value === 'right' || value === 'justify' ? value : undefined
}

/** Returns an indentation of 24 to 144 px in 24 px steps, or undefined for none. Throws for other values. */
export function normalizeIndent(value: unknown): string | undefined {
  if (value === null || value === undefined) return
  const match = typeof value === 'string' ? /^(\d+)px$/.exec(value) : null
  const pixels = match ? Number(match[1]) : NaN
  if (pixels === 0) return
  if (!(pixels % docxIndent.step === 0 && pixels > 0 && pixels <= docxIndent.max)) throw new Error('Use indentation steps of 24 pixels, up to 144 pixels.')
  return `${pixels}px`
}

/** Converts a Word left indent in twips to the nearest Folio step. */
export function indentFromTwips(twips: number): { indent?: string; exact: boolean } {
  const pixels = twips / docxIndent.twipsPerPixel
  const steps = Math.min(docxIndent.max / docxIndent.step, Math.max(0, Math.round(pixels / docxIndent.step)))
  return { indent: steps ? `${steps * docxIndent.step}px` : undefined, exact: steps * docxIndent.step === pixels }
}
