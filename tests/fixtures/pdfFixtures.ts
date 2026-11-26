/** Builds small, deterministic PDF files for tests. Objects are numbered from 1. */
function assemble(objects: (string | Uint8Array[])[], trailer: string) {
  const parts: Uint8Array[] = []
  const encoder = (text: string) => Uint8Array.from(text, character => character.charCodeAt(0) & 0xff)
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder(part) : part
    parts.push(bytes)
    length += bytes.length
  }
  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(length)
    push(`${index + 1} 0 obj\n`)
    if (typeof body === 'string') push(body)
    else body.forEach(push)
    push('\nendobj\n')
  })
  const xref = length
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (const offset of offsets) push(String(offset).padStart(10, '0') + ' 00000 n \n')
  push(`trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}

function stream(dictionary: string, data: string) {
  return `<< ${dictionary} /Length ${data.length} >>\nstream\n${data}\nendstream`
}

const escape = (text: string) => text.replace(/[\\()]/g, match => '\\' + match)

export interface PdfFixtureOptions {
  width?: number
  height?: number
  /** Extra catalog entries, such as `/OpenAction 9 0 R`. */
  catalog?: string
  /** Extra objects appended after pages, numbered from `firstExtraObject`. */
  extra?: string[]
  annotations?: (pageIndex: number) => string
  trailer?: string
}

/** Each page holds lines of Helvetica text, or an image when the entry is `null`. */
export function pdfFixture(pages: (string[] | null)[], options: PdfFixtureOptions = {}) {
  const width = options.width ?? 612
  const height = options.height ?? 792
  const objects: string[] = []
  // 1 catalog, 2 pages tree, 3 font, 4 image, then three objects per page.
  const pageIds = pages.map((_, index) => 5 + index * 2)
  objects[0] = `<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ''} >>`
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] /Count ${pages.length} >>`
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  // A 4x4 checkerboard with dark squares, scaled up as an image-only page.
  let pixels = ''
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) pixels += (x + y) % 2 ? '\xff\xff\xff' : '\x20\x40\x30'
  objects[3] = stream('/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8', pixels)
  pages.forEach((lines, index) => {
    const content = lines === null
      ? `q ${width - 144} 0 0 ${height - 144} 72 72 cm /Im1 Do Q`
      : 'BT /F1 18 Tf 72 ' + (height - 90) + ' Td 22 TL ' + lines.map(line => `(${escape(line)}) Tj T*`).join(' ') + ' ET'
    const annotations = options.annotations?.(index)
    objects[pageIds[index] - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${pageIds[index] + 1} 0 R ${annotations ? `/Annots [${annotations}]` : ''} >>`
    objects[pageIds[index]] = stream('', content)
  })
  for (const extra of options.extra ?? []) objects.push(extra)
  return assemble(objects, `/Root 1 0 R ${options.trailer ?? ''}`)
}

export function firstExtraObject(pageCount: number) { return 5 + pageCount * 2 }

/** A one-page PDF with an OpenAction script, a URI link, a form field and an embedded file. */
export function activeContentPdf() {
  const base = firstExtraObject(1)
  const [action, link, field, file, spec] = [base, base + 1, base + 2, base + 3, base + 4]
  return pdfFixture([['Active content fixture', 'Visit the example link']], {
    catalog: `/OpenAction ${action} 0 R /AcroForm << /Fields [${field} 0 R] >> /Names << /EmbeddedFiles << /Names [(note.txt) ${spec} 0 R] >> >>`,
    annotations: () => `${link} 0 R ${field} 0 R`,
    extra: [
      '<< /S /JavaScript /JS (globalThis.folioPdfScriptRan = true; app.alert\\("ran"\\);) >>',
      '<< /Type /Annot /Subtype /Link /Rect [72 650 400 680] /Border [0 0 0] /A << /S /URI /URI (https://example.invalid/folio-pdf-link) >> >>',
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (Prefilled) /Rect [72 560 300 590] /F 4 >>',
      stream('/Type /EmbeddedFile', 'attachment body'),
      `<< /Type /Filespec /F (note.txt) /EF << /F ${file} 0 R >> >>`,
    ],
  })
}

/** A PDF whose standard security handler rejects the empty user password. */
export function passwordPdf() {
  const hex = (seed: number) => Array.from({ length: 32 }, (_, index) => ((index * 37 + seed) & 0xff).toString(16).padStart(2, '0')).join('')
  const base = firstExtraObject(1)
  return pdfFixture([['Secret']], {
    extra: [`<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <${hex(11)}> /U <${hex(97)}> >>`],
    trailer: `/Encrypt ${base} 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>]`,
  })
}

export function malformedPdf() {
  return Uint8Array.from('%PDF-1.7\nthis is not a valid object graph\n%%EOF\n', character => character.charCodeAt(0))
}

export const searchablePages = [
  ['Folio PDF fixture page one', 'The quick brown fox jumps over the lazy dog.', 'Alpha beta gamma'],
  ['Second page heading', 'Search target appears here: needle', 'More text on page two'],
  ['Third page closing', 'Another needle near the end'],
]
