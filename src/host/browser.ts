import { decodeMarkdown, encodeMarkdown, markdownFilename, type WritableMarkdownHandle } from '../document/files'
import { insertDraft, loadLayout, loadLibrary, readDraft, recoverDocument, storeLayout, touchDocument, trashDocument, writeDraft } from '../document/workspaceStorage'
import { listVersions, readVersion, recordVersion, restoreVersion } from '../document/versions'
import { browserSearch } from './browserSearch'
import type { FileOperations, FolioHost } from './contracts'

type FilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<WritableMarkdownHandle>

const download: FileOperations['download'] = (filename, data, mediaType) => {
  const url = URL.createObjectURL(new Blob([data], { type: mediaType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const browserFiles: FileOperations = {
  download,
  async readMarkdown(input) { return decodeMarkdown(new Uint8Array(await input.arrayBuffer())) },
  async saveMarkdown(file, title, options) {
    const filename = markdownFilename(title)
    const picker = (window as Window & { showSaveFilePicker?: FilePicker }).showSaveFilePicker?.bind(window)
    let handle = options.download || options.saveAs ? undefined : options.handle
    if (!handle && !options.download && picker) {
      handle = await picker({ suggestedName: filename, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }] })
    }
    const bytes = encodeMarkdown(file)
    if (!handle) {
      download(filename, bytes, 'text/markdown;charset=utf-8')
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
  },
  async addAttachment(input) {
    if (!/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/i.test(input.type)) throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF, BMP, or ICO image.')
    const blob = input instanceof Blob ? input : new Blob([await input.arrayBuffer()], { type: input.type })
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    })
    return { url, alt: input.name.replace(/\.[^.]+$/, '') }
  },
}

const recentKey = 'folio.recent-commands.v1'

export const browserHost: FolioHost = {
  storage: { loadLibrary, loadLayout, storeLayout, readDraft, insertDraft, writeDraft, touchDocument, trashDocument,
    recoverDocument, listVersions, readVersion, recordVersion, restoreVersion },
  files: browserFiles,
  keyboard: { platform: typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other' },
  search: browserSearch,
  recentCommands: {
    read() {
      try {
        const values: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]')
        return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string').slice(0, 12) : []
      } catch { return [] }
    },
    write(ids) { try { localStorage.setItem(recentKey, JSON.stringify(ids)) } catch { /* The current session still has its recent commands. */ } },
  },
}
