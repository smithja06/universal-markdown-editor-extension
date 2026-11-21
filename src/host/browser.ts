import { decodeMarkdown, encodeMarkdown, markdownFilename, type WritableMarkdownHandle } from '../document/files'
import { insertDraft, loadLayout, loadLibrary, readDraft, recoverDocument, storeLayout, touchDocument, trashDocument, writeDraft } from '../document/workspaceStorage'
import { listVersions, readVersion, recordVersion, restoreVersion } from '../document/versions'
import { normalizeAppearance } from '../document/workspace'
import { browserSearch } from './browserSearch'
import type { AppearancePreferences, FileOperations, FolioHost } from './contracts'

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
      reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'))
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The image could not be read.'))
      reader.readAsDataURL(blob)
    })
    return { url, alt: input.name.replace(/\.[^.]+$/, '') }
  },
}

const recentKey = 'folio.recent-commands.v1'
const appearanceKey = 'folio.appearance.v1'

const appearance: AppearancePreferences = {
  read() {
    try {
      const stored = (JSON.parse(localStorage.getItem(appearanceKey) ?? '{}') ?? {}) as Parameters<typeof normalizeAppearance>[0]
      const prefersDark = stored.theme === 'system' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
      const current = normalizeAppearance(stored, prefersDark)
      if (stored.theme === 'system') appearance.write(current)
      return current
    } catch { return normalizeAppearance({}) }
  },
  write(value) { try { localStorage.setItem(appearanceKey, JSON.stringify(value)) } catch { /* Keep changes for this session. */ } },
}

export const browserHost: FolioHost = {
  storage: { loadLibrary, loadLayout, storeLayout, readDraft, insertDraft, writeDraft, touchDocument, trashDocument,
    recoverDocument, listVersions, readVersion, recordVersion, restoreVersion },
  files: browserFiles,
  appearance,
  clipboard: {
    async writeText(text) {
      const clipboard = navigator.clipboard
      if (!clipboard) throw new Error('Clipboard access is unavailable.')
      if (typeof text === 'string') await clipboard.writeText(text)
      else if (typeof ClipboardItem !== 'undefined' && clipboard.write) {
        const content = text().then(value => new Blob([value], { type: 'text/plain' }))
        await clipboard.write([new ClipboardItem({ 'text/plain': content })])
      } else await clipboard.writeText(await text())
    },
  },
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
