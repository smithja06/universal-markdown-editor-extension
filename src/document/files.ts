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

type FilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<WritableMarkdownHandle>

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

export function downloadFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function getSavePicker(): FilePicker | undefined {
  return (window as Window & { showSaveFilePicker?: FilePicker }).showSaveFilePicker?.bind(window)
}

export async function saveMarkdown(file: MarkdownFile, title: string, options: { handle?: WritableMarkdownHandle; saveAs?: boolean; download?: boolean } = {}) {
  const filename = markdownFilename(title)
  const picker = getSavePicker()
  let handle = options.download || options.saveAs ? undefined : options.handle
  if (!handle && !options.download && picker) {
    handle = await picker({ suggestedName: filename, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }] })
  }
  const bytes = encodeMarkdown(file)
  if (!handle) {
    downloadFile(filename, new Blob([bytes], { type: 'text/markdown;charset=utf-8' }))
    return { filename }
  }
  const stream = await handle.createWritable()
  try {
    await stream.write(bytes)
    await stream.close()
  } catch (error) {
    await stream.abort().catch(() => undefined)
    throw error
  }
  return { filename: handle.name, handle }
}

export interface AttachmentStore {
  add(file: File): Promise<{ url: string; alt: string }>
}

export const embeddedAttachments: AttachmentStore = {
  async add(file) {
    if (!/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/i.test(file.type)) throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF, BMP, or ICO image.')
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(file)
    })
    return { url, alt: file.name.replace(/\.[^.]+$/, '') }
  },
}
