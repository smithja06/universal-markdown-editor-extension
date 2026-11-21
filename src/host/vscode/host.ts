import type { ShortcutPlatform } from '../../core/commands'
import { normalizeAppearance, type Appearance } from '../../document/workspace'
import { createSearch } from '../browserSearch'
import type { DocumentStorage, FileOperations, FolioHost } from '../contracts'
import SearchWorker from '../searchWorker.ts?worker&inline'
import { createLiveDocumentClient, type LiveDocumentTransport } from './liveDocument'
import type { RecoveryJournal } from './recovery'

function unavailable() {
  return new Error('This operation is unavailable in the VS Code editor.')
}

function unsupported(): Promise<never> { return Promise.reject(unavailable()) }

const storage: DocumentStorage = {
  loadLibrary: unsupported,
  loadLayout: unsupported,
  storeLayout: unsupported,
  readDraft: unsupported,
  insertDraft: unsupported,
  writeDraft: unsupported,
  touchDocument: unsupported,
  trashDocument: unsupported,
  recoverDocument: unsupported,
  listVersions: unsupported,
  readVersion: unsupported,
  recordVersion: unsupported,
  restoreVersion: unsupported,
}

const files: FileOperations = {
  readMarkdown: unsupported,
  saveMarkdown: unsupported,
  download() { throw unavailable() },
  addAttachment: unsupported,
}

const search = createSearch(() => new SearchWorker())

export function createWebviewHost(transport: LiveDocumentTransport, platform: ShortcutPlatform, theme: Appearance['theme'], journal: RecoveryJournal) {
  const liveDocument = createLiveDocumentClient(transport, journal)
  let settings = normalizeAppearance({ theme })
  let recent: string[] = []
  return {
    liveDocument,
    storage,
    files,
    keyboard: { platform },
    appearance: {
      read: () => settings,
      write(value) { settings = value },
    },
    clipboard: {
      async writeText(text) {
        await liveDocument.copy(typeof text === 'string' ? text : await text())
      },
    },
    search,
    recentCommands: {
      read: () => recent,
      write(ids) { recent = ids },
    },
  } satisfies FolioHost
}
