const accentChannels = ['red', 'green', 'blue'] as const
export type AccentColor = Record<typeof accentChannels[number], number>
export type Theme = 'light' | 'dark'

export const forestAccent: AccentColor = { red: 34, green: 101, blue: 72 }

const white: AccentColor = { red: 255, green: 255, blue: 255 }
const black: AccentColor = { red: 0, green: 0, blue: 0 }

export function normalizeAccent(value: unknown): AccentColor {
  const saved = value && typeof value === 'object' ? value as Partial<Record<keyof AccentColor, unknown>> : {}
  const color = { ...forestAccent }
  for (const channel of accentChannels) {
    const component = saved[channel]
    if (typeof component === 'number' && Number.isFinite(component)) color[channel] = Math.max(0, Math.min(255, Math.round(component)))
  }
  return color
}

export const accentRgb = ({ red, green, blue }: AccentColor) => 'rgb(' + red + ', ' + green + ', ' + blue + ')'
export const accentHex = (color: AccentColor) => '#' + accentChannels.map(channel => color[channel].toString(16).padStart(2, '0')).join('').toUpperCase()

export function accentHue({ red, green, blue }: AccentColor) {
  const peak = Math.max(red, green, blue)
  const chroma = peak - Math.min(red, green, blue)
  if (chroma === 0) return 0
  const sector = peak === red ? (green - blue) / chroma
    : peak === green ? (blue - red) / chroma + 2
      : (red - green) / chroma + 4
  return Math.round((sector * 60 + 360) % 360) % 360
}

export function accentAtHue(hue: number): AccentColor {
  const sector = hue / 60
  const lightness = 0.45
  const saturation = 0.6
  const chroma = 2 * Math.min(lightness, 1 - lightness) * saturation
  const secondary = chroma * (1 - Math.abs(sector % 2 - 1))
  const [red, green, blue] = [
    [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
  ][Math.floor(sector)]
  const channel = (value: number) => Math.round((value + lightness - chroma / 2) * 255)
  return { red: channel(red), green: channel(green), blue: channel(blue) }
}

export const accentSpectrum = 'linear-gradient(to right, ' + [0, 60, 120, 180, 240, 300, 359]
  .map(hue => accentRgb(accentAtHue(hue)) + ' ' + (hue * 100 / 359) + '%').join(', ') + ')'

function mix(color: AccentColor, toward: AccentColor, amount: number): AccentColor {
  const channel = (key: keyof AccentColor) => Math.round(color[key] + (toward[key] - color[key]) * amount)
  return { red: channel('red'), green: channel('green'), blue: channel('blue') }
}

function luminance({ red, green, blue }: AccentColor) {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function contrast(a: AccentColor, b: AccentColor) {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function legibleAccent(color: AccentColor, background: AccentColor, toward: AccentColor) {
  if (contrast(color, background) >= 4.5) return color
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 8; iteration++) {
    const midpoint = (low + high) / 2
    if (contrast(mix(color, toward, midpoint), background) >= 4.5) high = midpoint
    else low = midpoint
  }
  return mix(color, toward, high)
}

export function accentTheme(color: AccentColor, theme: Theme) {
  const dark = theme === 'dark'
  const background = dark ? { red: 28, green: 36, blue: 32 } : white
  const surface = mix(background, color, dark ? 0.22 : 0.12)
  const tone = legibleAccent(color, surface, dark ? white : black)
  const whiteText = contrast(white, color) >= contrast(black, color)
  const fill = accentRgb(color)
  return {
    '--accent': accentRgb(tone),
    '--accent-strong': accentRgb(mix(tone, dark ? white : black, 0.1)),
    '--accent-surface': accentRgb(surface),
    '--accent-outline': accentRgb(mix(background, color, dark ? 0.42 : 0.33)),
    '--accent-fill': fill,
    '--accent-fill-border': contrast(color, background) >= 3 ? fill : accentRgb(tone),
    '--accent-fill-hover': accentRgb(mix(color, whiteText ? black : white, 0.16)),
    '--accent-fill-text': whiteText ? '#fff' : '#000',
  }
}

/** The color choices a VS Code host shares between every Folio editor. */
export interface ColorPreferences {
  /** Follow the VS Code color theme instead of Folio's own light or dark palette. */
  hostColors: boolean
  theme: Theme
  accentColor: AccentColor
}

export const defaultColorPreferences: ColorPreferences = { hostColors: true, theme: 'light', accentColor: forestAccent }

export function normalizeColorPreferences(value: unknown): ColorPreferences {
  const saved = value && typeof value === 'object' ? value as Partial<Record<keyof ColorPreferences, unknown>> : {}
  return { hostColors: saved.hostColors !== false, theme: saved.theme === 'dark' ? 'dark' : 'light', accentColor: normalizeAccent(saved.accentColor) }
}

export const sameColorPreferences = (a: ColorPreferences, b: ColorPreferences) => a.hostColors === b.hostColors && a.theme === b.theme &&
  a.accentColor.red === b.accentColor.red && a.accentColor.green === b.accentColor.green && a.accentColor.blue === b.accentColor.blue
