import type { Command, ShortcutPlatform } from '../core/commands'
import type { MarkdownFile, WritableMarkdownHandle } from '../document/files'
import type { Appearance, DocumentFile, DocumentSummary, WorkspaceLayout } from '../document/workspace'
import type { DocumentVersion, VersionResult, VersionSummary, VersionTrigger } from '../document/versions'
import type { SearchOptions, TextMatch } from '../core/search'
import type { RecoveryDraft } from './vscode/recovery'

export class WorkspaceRestoreConflict extends Error {
  constructor() { super('This document changed in another Folio tab. Download any edits from this tab before reloading.') }
}

export interface DocumentStorage {
  loadLibrary(): Promise<DocumentSummary[]>
  loadLayout(): Promise<WorkspaceLayout | undefined>
  storeLayout(layout: WorkspaceLayout): Promise<void>
  readDraft(id: string): Promise<DocumentFile | undefined>
  insertDraft(file: DocumentFile, words?: number): Promise<DocumentSummary>
  writeDraft(file: DocumentFile, words?: number, expected?: DocumentFile): Promise<DocumentSummary>
  touchDocument(id: string, openedAt: number): Promise<DocumentSummary>
  trashDocument(id: string): Promise<DocumentSummary>
  recoverDocument(id: string): Promise<DocumentSummary>
  listVersions(id: string): Promise<VersionSummary[]>
  readVersion(documentId: string, id: string): Promise<DocumentVersion | undefined>
  recordVersion(file: DocumentFile, trigger: VersionTrigger): Promise<VersionResult>
  restoreVersion(file: DocumentFile, id: string, known?: DocumentFile, words?: number): Promise<DocumentFile>
}

export interface FileInput { name: string; arrayBuffer(): Promise<ArrayBuffer> }
export interface FileOperations {
  readMarkdown(input: FileInput): Promise<MarkdownFile>
  saveMarkdown(file: MarkdownFile, title: string, options: { handle?: WritableMarkdownHandle; saveAs?: boolean; download?: boolean }): Promise<{ filename: string; handle?: WritableMarkdownHandle }>
  download(filename: string, data: string | Uint8Array<ArrayBuffer>, mediaType: string): void
  addAttachment(input: FileInput & { type: string }): Promise<{ url: string; alt: string }>
}

export interface AppearancePreferences {
  read(): Appearance
  write(appearance: Appearance): void
  themeFromHost?: (listener: (theme: Appearance['theme']) => void) => () => void
}

export interface LiveDocumentSnapshot {
  id: string
  title: string
  source: string
  revision?: number
  lineEnding: '\n' | '\r\n'
  dirty: boolean
  pending: boolean
  available: boolean
  conflict?: string
  message?: string
  recovery?: readonly RecoveryDraft[]
  recoveryWarning?: string
}

export interface LiveDocument {
  read(): LiveDocumentSnapshot
  subscribe(listener: (state: LiveDocumentSnapshot) => void): () => void
  edit(source: string): void
  run(command: 'save' | 'undo' | 'redo'): void
  discardRecovery(id: string): void
}

export interface FolioHost {
  storage: DocumentStorage
  files: FileOperations
  liveDocument?: LiveDocument
  appearance: AppearancePreferences
  clipboard: { writeText(text: string | (() => Promise<string>)): Promise<void> }
  notifications?: { show(message: string): void }
  keyboard: { platform: ShortcutPlatform; handledByHost?: ReadonlySet<string> }
  commands?: { attach(api: { commands(): Command[]; execute(id: string, argument?: string): boolean }): () => void }
  resources?: {
    image(reference: string, signal: AbortSignal): Promise<string | undefined>
    openMarkdown(reference: string): Promise<void>
    pickWorkspaceImage(revision: number, signal: AbortSignal, previousSelection?: number): Promise<{ id: number; reference: string } | undefined>
    confirmWorkspaceImage(selection: number, revision: number, signal: AbortSignal): Promise<void>
  }
  search(texts: string[], term: string, options: SearchOptions, signal: AbortSignal): Promise<TextMatch[]>
  recentCommands: { read(): string[]; write(ids: string[]): void }
}
