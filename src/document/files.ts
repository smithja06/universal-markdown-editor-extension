export interface MarkdownFile {
  source: string
  lineEnding: '\n' | '\r\n' | '\r'
  bom: boolean
  original?: { source: string; text: string }
}

export interface WritableMarkdownHandle {
  name: string
  createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}

export function decodeMarkdown(bytes: Uint8Array): MarkdownFile {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  const bom = text.startsWith('\uFEFF')
  const body = bom ? text.slice(1) : text
  const lineEnding = /\r\n|\r|\n/.exec(body)?.[0] as MarkdownFile['lineEnding'] | undefined
  const source = body.replace(/\r\n?/g, '\n')
  const mixed = lineEnding && body !== source.replace(/\n/g, lineEnding)
  return { source, lineEnding: lineEnding ?? '\n', bom, ...(mixed ? { original: { source, text: body } } : {}) }
}

export function encodeMarkdown(file: MarkdownFile): Uint8Array<ArrayBuffer> {
  const body = file.original?.source === file.source ? file.original.text : file.source.replace(/\n/g, file.lineEnding)
  return new TextEncoder().encode((file.bom ? '\uFEFF' : '') + body)
}

export function markdownFilename(title: string): string {
  const cleaned = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '') || 'Untitled'
  return /\.(?:md|markdown)$/i.test(cleaned) ? cleaned : `${cleaned}.md`
}
