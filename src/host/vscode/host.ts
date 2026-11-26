import type { ShortcutPlatform } from '../../core/commands'
import { normalizeAppearance, type Appearance } from '../../document/workspace'
import { createSearch } from '../browserSearch'
import type { DocumentStorage, FileOperations, FolioHost } from '../contracts'
import { downloadFile } from '../download'
import SearchWorker from '../searchWorker.ts?worker&inline'
import { createLiveDocumentClient, type LiveDocumentTransport } from './liveDocument'
import type { RecoveryJournal } from './recovery'
import { createWorkspaceResources } from './resources'
import { onWebviewTheme } from './theme'
import { colorPreferences, effectiveTheme, onColorPreferences, setColorPreferences } from './appearance'
import { createWorkspaceDocx } from './workspaceDocx'
import { createPdfCopy } from './pdfCopy'

function unavailable() {
  return new Error('This operation is unavailable in the VS Code editor.')
}

function unsupported(): Promise<never> { return Promise.reject(unavailable()) }

const storage: DocumentStorage = {
  loadLibrary: unsupported,
  loadLayout: unsupported,
  storeLayout: unsupported,
  readDraft: unsupported,
  readOriginal: unsupported,
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
  saveMarkdown: unsupported,
  download() { throw unavailable() },
  addAttachment: unsupported,
}

const search = createSearch(() => new SearchWorker())

export function createWebviewHost(transport: LiveDocumentTransport, platform: ShortcutPlatform, journal: RecoveryJournal, format = 'Markdown') {
  const liveDocument = createLiveDocumentClient(transport, journal)
  const resources = format === 'Markdown' ? createWorkspaceResources(transport) : undefined
  const workspaceDocx = format === 'DOCX' ? createWorkspaceDocx(transport) : undefined
  const colors = colorPreferences()
  let settings: Appearance = { ...normalizeAppearance(colors), theme: effectiveTheme(colors) }
  let recent: string[] = []
  return {
    liveDocument,
    storage,
    files: workspaceDocx ? { ...files, download: downloadFile } : files,
    workspaceDocx,
    pdfExport: createPdfCopy(transport),
    keyboard: { platform, handledByHost: new Set(['workspace.palette']) },
    appearance: {
      read: () => settings,
      write(value) {
        settings = value
        setColorPreferences({ hostColors: value.hostColors, theme: value.theme, accentColor: value.accentColor })
      },
      themeFromHost: onWebviewTheme,
      // Other Folio editors share the color choice through the extension host.
      subscribe: listener => onColorPreferences(colors => {
        const update = { hostColors: colors.hostColors, accentColor: colors.accentColor, theme: effectiveTheme(colors) }
        settings = { ...settings, ...update }
        listener(update)
      }),
    },
    commands: {
      attach(api) {
        return transport.listen(message => {
          if (message.type === 'action') api.execute(message.action)
        })
      },
    },
    resources,
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
    dispose() { workspaceDocx?.dispose(); resources?.dispose(); liveDocument.dispose() },
  } satisfies FolioHost & { dispose(): void }
}
