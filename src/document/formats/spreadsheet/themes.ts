/** Workbook color themes. IronCalc 0.9.1 writes the theme to xl/theme/theme1.xml and reads it back. */
export interface WorkbookTheme {
  name: string
  dk1: string; lt1: string; dk2: string; lt2: string
  accent1: string; accent2: string; accent3: string; accent4: string; accent5: string; accent6: string
  hlink: string; fol_hlink: string
}

export const themeSlots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'fol_hlink'] as const

/** IronCalc 0.9.1's built-in themes, from getThemeList(). formulaCatalog-style tests keep this copy in sync with the engine. */
export const builtinThemes: readonly WorkbookTheme[] = [
  { name: 'IronCalc', dk1: '#272525', lt1: '#FFFFFF', dk2: '#333333', lt2: '#F8F4F1', accent1: '#8CB354', accent2: '#F8CD3D', accent3: '#F2994A', accent4: '#EC5753', accent5: '#523E93', accent6: '#3458B7', hlink: '#F2994A', fol_hlink: '#843BBC' },
  { name: 'Office', dk1: '#000000', lt1: '#FFFFFF', dk2: '#44546A', lt2: '#E7E6E6', accent1: '#4472C4', accent2: '#ED7D31', accent3: '#A5A5A5', accent4: '#FFC000', accent5: '#5B9BD5', accent6: '#70AD47', hlink: '#0563C1', fol_hlink: '#954F72' },
  { name: 'Cold', dk1: '#1C1C1E', lt1: '#FFFFFF', dk2: '#283640', lt2: '#F2F7FA', accent1: '#2E8BC0', accent2: '#5FA8D3', accent3: '#A6DCEF', accent4: '#D6EBF2', accent5: '#90ADC6', accent6: '#547AA5', hlink: '#843BBC', fol_hlink: '#B984E2' },
  { name: 'Warm', dk1: '#272525', lt1: '#FFFFFF', dk2: '#2E1D0B', lt2: '#FDFAF6', accent1: '#C1440E', accent2: '#F26800', accent3: '#F89D13', accent4: '#FFD56F', accent5: '#DDA15E', accent6: '#8D4B1F', hlink: '#4C4B63', fol_hlink: '#9190AD' },
  { name: 'Ocean', dk1: '#001A21', lt1: '#FFFFFF', dk2: '#123637', lt2: '#F4FBFB', accent1: '#007C91', accent2: '#00A6A6', accent3: '#58C9B9', accent4: '#A0E8E0', accent5: '#44BFC8', accent6: '#1C7C7D', hlink: '#7D1C58', fol_hlink: '#994B7B' },
  { name: 'Pastel', dk1: '#2E2E2E', lt1: '#FFFFFF', dk2: '#434742', lt2: '#FBF5FB', accent1: '#F4C2CE', accent2: '#AAD6F2', accent3: '#BBEC7E', accent4: '#F4EBB9', accent5: '#CCC0EC', accent6: '#A2CFEE', hlink: '#F6A6B2', fol_hlink: '#C9A6F6' },
  { name: 'Contrast', dk1: '#272525', lt1: '#FFFFFF', dk2: '#373F3E', lt2: '#F0F6F6', accent1: '#4ECDC4', accent2: '#FFDA0B', accent3: '#FF8009', accent4: '#FF006E', accent5: '#AA38EC', accent6: '#1255FF', hlink: '#FF8009', fol_hlink: '#AA38EC' },
  { name: 'Forest', dk1: '#272525', lt1: '#FFFFFF', dk2: '#28281E', lt2: '#F6F6ED', accent1: '#3A6B35', accent2: '#7DAB5F', accent3: '#C8A84B', accent4: '#B85C38', accent5: '#8C6F48', accent6: '#5A462B', hlink: '#3F88C5', fol_hlink: '#86AFD2' },
  { name: 'Greyscale', dk1: '#000000', lt1: '#FFFFFF', dk2: '#272525', lt2: '#F5F5F5', accent1: '#333333', accent2: '#989898', accent3: '#C7C7C7', accent4: '#F2F2F2', accent5: '#828282', accent6: '#4F4F4F', hlink: '#4F4F4F', fol_hlink: '#808080' },
  { name: 'Sunshine', dk1: '#1E1400', lt1: '#FFFFFF', dk2: '#493502', lt2: '#F7F4EE', accent1: '#FF7C01', accent2: '#FFAA01', accent3: '#FFD103', accent4: '#FFEC18', accent5: '#FFC400', accent6: '#FF9502', hlink: '#2872FD', fol_hlink: '#AC2CFB' },
  { name: 'Emerald', dk1: '#11160D', lt1: '#FFFFFF', dk2: '#303C22', lt2: '#F3F7EF', accent1: '#5C8148', accent2: '#8BB650', accent3: '#B3E093', accent4: '#D6ED89', accent5: '#A2C181', accent6: '#76A45B', hlink: '#5A462B', fol_hlink: '#98794E' },
]

export function isWorkbookTheme(value: unknown): value is WorkbookTheme {
  if (!value || typeof value !== 'object') return false
  const theme = value as Record<string, unknown>
  return typeof theme.name === 'string' && theme.name.length > 0 && theme.name.length <= 64 &&
    Object.keys(theme).length === themeSlots.length + 1 &&
    themeSlots.every(slot => typeof theme[slot] === 'string' && /^#[0-9A-F]{6}$/i.test(theme[slot] as string))
}

/** Mixes a theme color toward white, as Office tints do. `amount` 0.8 gives a light fill. */
export function themeTint(hex: string, amount: number) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
  return '#' + channels.map(channel => Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0')).join('')
}

/** Swatches a color picker offers for the workbook theme: the four text and background colors, then the six accents. */
export function themeSwatches(theme: WorkbookTheme) {
  return themeSlots.slice(0, 10).map(slot => ({ slot, color: theme[slot].toLowerCase() }))
}
