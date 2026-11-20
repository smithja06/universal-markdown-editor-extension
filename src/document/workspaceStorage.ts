import type { WorkspaceSnapshot } from './workspace'

export const recentLimit = 15
export const sessionsStore = 'sessions'
export const versionsStore = 'document-versions'
export const versionContentStore = 'version-content'
export const versionOrderIndex = 'document-date'
export const versionKindIndex = 'document-kind-date'

export class WorkspaceRestoreConflict extends Error {
  constructor() { super('A version was restored in another Folio tab. Download any edits from this tab before reloading.') }
}

let database: Promise<IDBDatabase> | undefined
let blockedUpgrade: Error | undefined
function openDatabase() {
  if (blockedUpgrade) return Promise.reject(blockedUpgrade)
  if (database) return database
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('folio-workspace', 2)
    request.onupgradeneeded = event => {
      const db = request.result
      if (event.oldVersion < 1) db.createObjectStore(sessionsStore)
      if (event.oldVersion < 2) {
        const versions = db.createObjectStore(versionsStore, { keyPath: 'id' })
        versions.createIndex(versionOrderIndex, ['documentId', 'createdAt'], { unique: true })
        versions.createIndex(versionKindIndex, ['documentId', 'kind', 'createdAt'])
        db.createObjectStore(versionContentStore)
      }
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
      reject(request.error)
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
    request.onerror = () => reject(request.error)
  })
}

export async function workspaceTransaction<T>(stores: string[], mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<T>, options?: IDBTransactionOptions): Promise<T> {
  const db = await openDatabase()
  const transaction = db.transaction(stores, mode, options)
  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('The local storage transaction was interrupted.'))
  })
  void finished.catch(() => undefined)
  try {
    const result = await work(transaction)
    await finished
    return result
  } catch (error) {
    try { transaction.abort() } catch { /* IndexedDB may have already aborted. */ }
    await finished.catch(() => undefined)
    throw error
  }
}

export function readWorkspaceRecord(transaction: IDBTransaction): Promise<WorkspaceSnapshot | undefined> {
  return requestResult(transaction.objectStore(sessionsStore).get('current'))
}

export function writeWorkspaceRecord(transaction: IDBTransaction, snapshot: WorkspaceSnapshot, saved?: WorkspaceSnapshot, restoredId?: string) {
  const versions = new Map((saved?.files ?? []).map(file => [file.id, file]))
  for (const file of snapshot.files) {
    const previous = versions.get(file.id)
    if (previous && previous.historyEpoch !== file.historyEpoch && file.id !== restoredId) {
      if (file.id === snapshot.currentId) throw new WorkspaceRestoreConflict()
      continue
    }
    if (!previous || file.updated >= previous.updated) versions.set(file.id, file)
  }
  const active = versions.get(snapshot.currentId)
  const others = [...versions.values()].filter(file => file.id !== snapshot.currentId).sort((a, b) => b.updated - a.updated)
  const files = active ? [active, ...others.slice(0, recentLimit - 1)] : others.slice(0, recentLimit)
  return requestResult(transaction.objectStore(sessionsStore).put({ currentId: snapshot.currentId, files }, 'current'))
}

export function loadWorkspace() {
  return workspaceTransaction([sessionsStore], 'readonly', readWorkspaceRecord)
}

export function storeWorkspace(snapshot: WorkspaceSnapshot) {
  return workspaceTransaction([sessionsStore], 'readwrite', async transaction => {
    await writeWorkspaceRecord(transaction, snapshot, await readWorkspaceRecord(transaction))
  })
}
