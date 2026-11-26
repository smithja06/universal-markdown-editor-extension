import { sameContent, sameLineage, type DocumentContent } from './formats/content'
import type { DocumentFile } from './workspace'
import {
  documentsStore, draftStores, getDraft, getSummary, putDraft, requestResult, requireLiveDocument,
  versionContentStore, versionKindIndex, versionOrderIndex, versionsStore, workspaceTransaction,
} from './workspaceStorage'

export const versionInterval = 60_000
export const automaticVersionLimit = 30

export function versionStorageError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Browser storage is full. Version history could not be saved.'
  return error instanceof Error ? error.message : 'Could not access local version history.'
}
export type VersionKind = 'automatic' | 'manual' | 'recovery'
export type VersionTrigger = 'interval' | 'checkpoint' | 'manual'

export interface VersionSummary {
  id: string
  documentId: string
  createdAt: number
  kind: VersionKind
  title: string
  bytes: number
}

export interface DocumentVersion extends VersionSummary { content: DocumentContent }

export interface VersionResult {
  status: 'created' | 'existing' | 'promoted' | 'deferred'
  version: VersionSummary
}

const historyStores = [versionsStore, versionContentStore]
const encoder = new TextEncoder()

function dateRange(documentId: string, kind?: VersionKind) {
  const key = kind ? [documentId, kind] : [documentId]
  return IDBKeyRange.bound([...key, 0], [...key, Number.MAX_SAFE_INTEGER])
}

function contentOf(file: DocumentFile): DocumentContent {
  const { source, bom, lineEnding } = file
  if (file.format === 'pdf') throw new Error('PDF documents are read-only and have no version history.')
  if (file.format === 'docx') {
    const { format, schemaVersion, document, issues, originalFile } = file
    return { format, schemaVersion, document, issues, source, bom: false, lineEnding: '\n', ...(originalFile ? { originalFile } : {}) }
  }
  if (file.format === 'txt') {
    const { format, schemaVersion, mixedLineEndings, originalFile } = file
    return { format, schemaVersion, source, bom, lineEnding, mixedLineEndings, ...(originalFile ? { originalFile } : {}) }
  }
  return { format: 'markdown', schemaVersion: 1, source, bom, lineEnding,
    ...(file.original?.source === source ? { original: file.original } : {}) }
}

function sameDraft(left: DocumentFile, right: DocumentFile) {
  return left.title === right.title && sameContent(left, right)
}

async function appendVersion(transaction: IDBTransaction, file: DocumentFile, trigger: VersionTrigger | 'recovery', now: number): Promise<VersionResult> {
  const versions = transaction.objectStore(versionsStore)
  const payloads = transaction.objectStore(versionContentStore)
  const cursor = await requestResult(versions.index(versionOrderIndex).openCursor(dateRange(file.id), 'prev'))
  const latest = cursor?.value as VersionSummary | undefined
  if (trigger === 'interval' && latest && now - latest.createdAt < versionInterval) return { status: 'deferred', version: latest }
  const kind = trigger === 'manual' || trigger === 'recovery' ? trigger : 'automatic'
  const content = contentOf(file)
  if (latest && latest.title === file.title) {
    const previous: DocumentContent | undefined = await requestResult(payloads.get(latest.id))
    if (previous && sameContent(content, previous)) {
      if (kind !== 'automatic' && latest.kind === 'automatic') {
        const promoted = { ...latest, kind }
        await requestResult(versions.put(promoted))
        return { status: 'promoted', version: promoted }
      }
      return { status: 'existing', version: latest }
    }
  }

  const version: VersionSummary = {
    id: crypto.randomUUID(), documentId: file.id, createdAt: Math.max(now, (latest?.createdAt ?? -1) + 1),
    kind, title: file.title, bytes: content.format === 'docx' ? encoder.encode(JSON.stringify(content)).byteLength
      : encoder.encode(content.source).byteLength + encoder.encode(content.original?.text ?? '').byteLength,
  }
  if (kind === 'automatic') {
    const keys = await requestResult(versions.index(versionKindIndex).getAllKeys(dateRange(file.id, kind)))
    for (const key of keys.slice(0, Math.max(0, keys.length + 1 - automaticVersionLimit))) {
      await requestResult(versions.delete(key))
      await requestResult(payloads.delete(key))
    }
  }
  await requestResult(versions.add(version))
  await requestResult(payloads.add(content, version.id))
  return { status: 'created', version }
}

export function recordVersion(file: DocumentFile, trigger: VersionTrigger, now = Date.now()) {
  return workspaceTransaction([...historyStores, documentsStore], 'readwrite', async transaction => {
    requireLiveDocument(await getSummary(transaction, file.id))
    return appendVersion(transaction, file, trigger, now)
  })
}

export function listVersions(documentId: string): Promise<VersionSummary[]> {
  return workspaceTransaction([versionsStore], 'readonly', async transaction => {
    const entries: VersionSummary[] = await requestResult(transaction.objectStore(versionsStore).index(versionOrderIndex).getAll(dateRange(documentId)))
    return entries.reverse()
  })
}

async function versionIn(transaction: IDBTransaction, documentId: string, id: string): Promise<DocumentVersion | undefined> {
  const summary: VersionSummary | undefined = await requestResult(transaction.objectStore(versionsStore).get(id))
  if (summary?.documentId !== documentId) return undefined
  const content: DocumentContent | undefined = await requestResult(transaction.objectStore(versionContentStore).get(id))
  if (!content) throw new Error('This saved version is incomplete.')
  return { ...summary, content }
}

export function readVersion(documentId: string, id: string) {
  return workspaceTransaction(historyStores, 'readonly', transaction => versionIn(transaction, documentId, id))
}

export function restoreVersion(current: DocumentFile, id: string, known?: DocumentFile, words?: number) {
  return workspaceTransaction([...historyStores, ...draftStores], 'readwrite', async transaction => {
    const version = await versionIn(transaction, current.id, id)
    if (!version) throw new Error('This version is no longer available.')
    if (!sameLineage(current, version.content)) throw new Error('This version does not match the document format or original file.')
    const summary = await getSummary(transaction, current.id)
    requireLiveDocument(summary)
    const persisted = await getDraft(transaction, current.id)
    const changedElsewhere = persisted && !sameDraft(persisted, current) && (known
      ? (persisted.updated !== known.updated || !sameDraft(persisted, known))
      : persisted.updated > current.updated)
    if (persisted && (persisted.historyEpoch !== current.historyEpoch || changedElsewhere)) {
      throw new Error('This draft changed in another Folio tab. Reopen the document to restore from history.')
    }
    const now = Date.now()
    await appendVersion(transaction, current, 'recovery', now)
    const restored: DocumentFile = {
      ...version.content, id: current.id, savedSource: current.savedSource, savedTitle: current.savedTitle, title: version.title,
      updated: Math.max(now, current.updated + 1, (persisted?.updated ?? -1) + 1),
      historyEpoch: crypto.randomUUID(),
    }
    await putDraft(transaction, restored, summary, words)
    return restored
  }, { durability: 'strict' })
}
