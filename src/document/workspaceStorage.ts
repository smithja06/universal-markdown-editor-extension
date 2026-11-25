import { draftSummary, emptyLayout, withoutTabs, type DocumentFile, type DocumentSummary, type WorkspaceLayout } from './workspace'
import { WorkspaceRestoreConflict } from '../host/contracts'
import { originalReference, sameContent, sameLineage, type OriginalFile } from './formats/content'

export const sessionsStore = 'sessions'
export const documentsStore = 'documents'
export const draftsStore = 'document-drafts'
export const versionsStore = 'document-versions'
export const versionContentStore = 'version-content'
export const originalsStore = 'document-originals'
export const versionOrderIndex = 'document-date'
export const versionKindIndex = 'document-kind-date'

let database: Promise<IDBDatabase> | undefined
let blockedUpgrade: Error | undefined
function openDatabase() {
  if (blockedUpgrade) return Promise.reject(blockedUpgrade)
  if (database) return database
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('folio-workspace', 4)
    request.onupgradeneeded = event => {
      const db = request.result
      if (event.oldVersion < 1) db.createObjectStore(sessionsStore)
      if (event.oldVersion < 2) {
        const versions = db.createObjectStore(versionsStore, { keyPath: 'id' })
        versions.createIndex(versionOrderIndex, ['documentId', 'createdAt'], { unique: true })
        versions.createIndex(versionKindIndex, ['documentId', 'kind', 'createdAt'])
        db.createObjectStore(versionContentStore)
      }
      if (event.oldVersion < 3) {
        const documents = db.createObjectStore(documentsStore, { keyPath: 'id' })
        const drafts = db.createObjectStore(draftsStore, { keyPath: 'id' })
        const sessions = request.transaction!.objectStore(sessionsStore)
        const existing = sessions.get('current')
        existing.onsuccess = () => {
          const legacy = existing.result as { currentId: string; files: DocumentFile[] } | undefined
          if (!legacy) return
          for (const file of legacy.files) {
            documents.put({ ...draftSummary(file), openedAt: file.updated })
            drafts.put(file)
          }
          if (legacy.files.some(file => file.id === legacy.currentId)) {
            sessions.put({ activeId: legacy.currentId, tabs: [{ id: legacy.currentId, mode: 'visual' }], closed: [] } satisfies WorkspaceLayout, 'layout')
          }
          sessions.delete('current')
        }
      }
      if (event.oldVersion < 4) db.createObjectStore(originalsStore, { keyPath: 'reference.id' })
    }
    request.onblocked = () => {
      blockedUpgrade = new Error('Close older Folio tabs to finish upgrading local storage, then retry.')
      reject(blockedUpgrade)
    }
    request.onerror = () => {
      if (database === opening) {
        blockedUpgrade = undefined
        database = undefined
      }
      reject(request.error ?? new Error('Could not open local workspace storage.'))
    }
    request.onsuccess = () => {
      const db = request.result
      // A blocked open remains queued in IndexedDB. Reuse its connection when it finishes.
      const connected = Promise.resolve(db)
      blockedUpgrade = undefined
      database = connected
      const disconnect = () => {
        db.close()
        if (database === connected) database = undefined
      }
      db.onversionchange = disconnect
      db.onclose = disconnect
      resolve(db)
    }
  })
  database = opening
  void opening.catch(() => { if (database === opening && !blockedUpgrade) database = undefined })
  return opening
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('A local storage request failed.'))
  })
}

export async function workspaceTransaction<T>(stores: string[], mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<T>, options?: IDBTransactionOptions, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const db = await openDatabase()
  signal?.throwIfAborted()
  const transaction = db.transaction(stores, mode, options)
  const abort = () => { try { transaction.abort() } catch { /* IndexedDB may have already finished. */ } }
  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('The local storage transaction was interrupted.'))
  })
  void finished.catch(() => undefined)
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await work(transaction)
    await finished
    return result
  } catch (error) {
    abort()
    await finished.catch(() => undefined)
    signal?.throwIfAborted()
    throw error
  } finally { signal?.removeEventListener('abort', abort) }
}

export function getSummary(transaction: IDBTransaction, id: string): Promise<DocumentSummary | undefined> {
  return requestResult(transaction.objectStore(documentsStore).get(id))
}

export function getDraft(transaction: IDBTransaction, id: string): Promise<DocumentFile | undefined> {
  return requestResult(transaction.objectStore(draftsStore).get(id))
}

export function requireLiveDocument(summary?: DocumentSummary): asserts summary is DocumentSummary {
  if (!summary) throw new Error('This document could not be found.')
  if (summary.deletedAt !== undefined) throw new Error('This document is in Trash. Restore it before editing.')
}

export async function putDraft(transaction: IDBTransaction, file: DocumentFile, summary: DocumentSummary, words?: number) {
  const next = draftSummary(file, summary, words)
  await requestResult(transaction.objectStore(draftsStore).put(file))
  await requestResult(transaction.objectStore(documentsStore).put(next))
  return next
}

export const draftStores = [documentsStore, draftsStore]

export function loadLibrary(): Promise<DocumentSummary[]> {
  return workspaceTransaction([documentsStore], 'readonly', transaction => requestResult(transaction.objectStore(documentsStore).getAll()))
}

export function loadLayout(): Promise<WorkspaceLayout | undefined> {
  return workspaceTransaction([sessionsStore], 'readonly', transaction => requestResult(transaction.objectStore(sessionsStore).get('layout')))
}

export function storeLayout(layout: WorkspaceLayout) {
  return workspaceTransaction([sessionsStore, documentsStore], 'readwrite', async transaction => {
    const ids = Array.from(new Set([...layout.tabs, ...layout.closed].map(tab => tab.id)))
    const summaries = await Promise.all(ids.map(id => getSummary(transaction, id)))
    const invalid = new Set(ids.filter((_, index) => !summaries[index] || summaries[index].deletedAt !== undefined))
    const next = withoutTabs(layout, invalid, false)
    await requestResult(transaction.objectStore(sessionsStore).put(next, 'layout'))
  })
}

export function readDraft(id: string) {
  return workspaceTransaction(draftStores, 'readonly', async transaction => {
    const summary = await getSummary(transaction, id)
    if (!summary || summary.deletedAt !== undefined) return
    return getDraft(transaction, id)
  })
}

export function readOriginal(id: string) {
  return workspaceTransaction([originalsStore], 'readonly', async transaction => {
    const original: OriginalFile | undefined = await requestResult(transaction.objectStore(originalsStore).get(id))
    return original?.bytes
  })
}

export function insertDraft(file: DocumentFile, words?: number, original?: OriginalFile, signal?: AbortSignal) {
  const reference = originalReference(file)
  return workspaceTransaction(reference || original ? [...draftStores, originalsStore] : draftStores, 'readwrite', async transaction => {
    const summary = draftSummary(file, undefined, words)
    await requestResult(transaction.objectStore(documentsStore).add(summary))
    await requestResult(transaction.objectStore(draftsStore).add(file))
    if (original) {
      if (reference?.id !== original.reference.id || reference.byteLength !== original.bytes.size || reference.sha256 !== original.reference.sha256) {
        throw new Error('The original file does not match this draft.')
      }
      await requestResult(transaction.objectStore(originalsStore).add(original))
    } else if (reference && await requestResult(transaction.objectStore(originalsStore).getKey(reference.id)) === undefined) {
      throw new Error('The original file for this draft is unavailable.')
    }
    return summary
  }, original ? { durability: 'strict' } : undefined, signal)
}

export function writeDraft(file: DocumentFile, words?: number, expected?: DocumentFile) {
  return workspaceTransaction(draftStores, 'readwrite', async transaction => {
    const summary = await getSummary(transaction, file.id)
    requireLiveDocument(summary)
    const previous = await getDraft(transaction, file.id)
    const changed = previous && expected && (previous.updated !== expected.updated || !sameContent(previous, expected) || previous.title !== expected.title ||
      previous.savedSource !== expected.savedSource || previous.savedTitle !== expected.savedTitle)
    if (!previous || !sameLineage(previous, file) || previous.historyEpoch !== file.historyEpoch || previous.updated > file.updated || changed) throw new WorkspaceRestoreConflict()
    return putDraft(transaction, file, summary, words)
  })
}

export function touchDocument(id: string, openedAt: number) {
  return workspaceTransaction([documentsStore], 'readwrite', async transaction => {
    const summary = await getSummary(transaction, id)
    requireLiveDocument(summary)
    const next = { ...summary, openedAt: Math.max(summary.openedAt ?? 0, openedAt) }
    await requestResult(transaction.objectStore(documentsStore).put(next))
    return next
  })
}

export function trashDocument(id: string) {
  return workspaceTransaction([documentsStore, sessionsStore], 'readwrite', async transaction => {
    const summary = await getSummary(transaction, id)
    requireLiveDocument(summary)
    const next = { ...summary, deletedAt: Date.now() }
    await requestResult(transaction.objectStore(documentsStore).put(next))
    const sessions = transaction.objectStore(sessionsStore)
    const layout: WorkspaceLayout = await requestResult(sessions.get('layout')) ?? emptyLayout
    await requestResult(sessions.put(withoutTabs(layout, new Set([id]), false), 'layout'))
    return next
  })
}

export function recoverDocument(id: string) {
  return workspaceTransaction(draftStores, 'readwrite', async transaction => {
    const summary = await getSummary(transaction, id)
    const file = await getDraft(transaction, id)
    if (!summary || !file || summary.deletedAt === undefined) throw new Error('This document could not be found in Trash.')
    return putDraft(transaction, { ...file, historyEpoch: crypto.randomUUID() }, { ...summary, deletedAt: undefined })
  })
}
