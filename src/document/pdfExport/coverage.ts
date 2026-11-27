/** Reads the Unicode code points a TrueType font maps through its cmap table (formats 4 and 12). */
export function fontCoverage(bytes: Uint8Array): Set<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = view.getUint16(4)
  let cmap = -1
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) === 'cmap') cmap = view.getUint32(record + 8)
  }
  if (cmap < 0) throw new Error('The font has no character map.')
  const points = new Set<number>()
  const subtables = view.getUint16(cmap + 2)
  let best: { offset: number; format: number } | undefined
  for (let index = 0; index < subtables; index++) {
    const platform = view.getUint16(cmap + 4 + index * 8)
    const encoding = view.getUint16(cmap + 6 + index * 8)
    const offset = cmap + view.getUint32(cmap + 8 + index * 8)
    const format = view.getUint16(offset)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (unicode && (format === 12 || (format === 4 && best?.format !== 12))) best = { offset, format }
  }
  if (!best) throw new Error('The font has no Unicode character map.')
  const { offset, format } = best
  if (format === 12) {
    const groups = view.getUint32(offset + 12)
    for (let group = 0; group < groups; group++) {
      const start = view.getUint32(offset + 16 + group * 12)
      const end = view.getUint32(offset + 20 + group * 12)
      for (let point = start; point <= end && point <= 0x10ffff; point++) points.add(point)
    }
    return points
  }
  const segments = view.getUint16(offset + 6) / 2
  const ends = offset + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const ranges = deltas + segments * 2
  for (let segment = 0; segment < segments; segment++) {
    const end = view.getUint16(ends + segment * 2)
    const start = view.getUint16(starts + segment * 2)
    const delta = view.getInt16(deltas + segment * 2)
    const rangeOffset = view.getUint16(ranges + segment * 2)
    for (let point = start; point <= end && point !== 0xffff; point++) {
      let glyph: number
      if (rangeOffset === 0) glyph = (point + delta) & 0xffff
      else {
        const address = ranges + segment * 2 + rangeOffset + (point - start) * 2
        glyph = view.getUint16(address)
        if (glyph) glyph = (glyph + delta) & 0xffff
      }
      if (glyph) points.add(point)
    }
  }
  return points
}

/** Characters that need no glyph: controls, whitespace handled by layout, joiners and variation selectors. */
export function needsGlyph(point: number) {
  return point > 0x20 && point !== 0x7f && !(point >= 0x80 && point < 0xa0) && point !== 0x200b && point !== 0xfeff &&
    point !== 0x200c && point !== 0x200d && !(point >= 0xfe00 && point <= 0xfe0f) && !(point >= 0xe0100 && point <= 0xe01ef)
}

/** The visible stand-in for characters no bundled font can draw, for example `[U+4E2D U+6587]`. */
export function codePointMarker(characters: string[]) {
  return '[' + characters.map(character => 'U+' + character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ') + ']'
}
