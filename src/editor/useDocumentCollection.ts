import { useCallback, useRef, useState } from 'react'
import { draftSummary, emptyLayout, type DocumentFile, type DocumentSummary, type WorkspaceLayout } from '../document/workspace'
import type { OriginalFile } from '../document/formats/content'
import type { DocumentStorage } from '../host/contracts'

export function useDocumentCollection(storage: DocumentStorage) {
  const [library, setLibrary] = useState<DocumentSummary[]>([])
  const [layout, setLayout] = useState<WorkspaceLayout>(emptyLayout)
  const documents = useRef(new Map<string, DocumentSummary>())
  const workspace = useRef<WorkspaceLayout>(emptyLayout)
  const drafts = useRef(new Map<string, DocumentFile>())
  const persisted = useRef(new Map<string, DocumentFile>())
  const newIds = useRef(new Set<string>())
  const writing = useRef(Promise.resolve())
  const storedLayout = useRef('')
  const pendingLayout = useRef<{ key: string; write: Promise<void> } | undefined>(undefined)

  const enqueue = useCallback(<T,>(operation: () => Promise<T>) => {
    const result = writing.current.then(operation)
    writing.current = result.then(() => undefined, () => undefined)
    return result
  }, [])

  const updateSummary = useCallback((summary: DocumentSummary) => {
    documents.current.set(summary.id, summary)
    setLibrary([...documents.current.values()])
  }, [])

  const loadCollection = useCallback((items: DocumentSummary[], next: WorkspaceLayout) => {
    documents.current = new Map(items.map(item => [item.id, item]))
    workspace.current = next
    storedLayout.current = JSON.stringify(next)
    setLibrary(items)
    setLayout(next)
  }, [])

  const changeLayout = useCallback((next: WorkspaceLayout, commitFirst = false) => {
    const key = JSON.stringify(next)
    const publish = () => { workspace.current = next; setLayout(next) }
    if (!commitFirst && JSON.stringify(workspace.current) !== key) publish()
    if (!pendingLayout.current && storedLayout.current === key) {
      if (commitFirst) publish()
      return Promise.resolve()
    }
    if (pendingLayout.current?.key === key) return commitFirst ? pendingLayout.current.write.then(publish) : pendingLayout.current.write
    const write = enqueue(() => storage.storeLayout(next)).then(() => { storedLayout.current = key }).finally(() => {
      if (pendingLayout.current?.write === write) pendingLayout.current = undefined
    })
    pendingLayout.current = { key, write }
    if (commitFirst) return write.then(publish)
    return write
  }, [enqueue, storage])

  const cache = useCallback((file: DocumentFile, words?: number, created = false) => {
    drafts.current.set(file.id, file)
    if (created) newIds.current.add(file.id)
    updateSummary(draftSummary(file, documents.current.get(file.id), words))
  }, [updateSummary])

  const persist = useCallback((file: DocumentFile, words?: number, created = false) => {
    cache(file, words, created)
    return enqueue(async () => {
      const summary = newIds.current.has(file.id) ? await storage.insertDraft(file, words) : await storage.writeDraft(file, words, persisted.current.get(file.id))
      newIds.current.delete(file.id)
      persisted.current.set(file.id, file)
      if (drafts.current.get(file.id) === file) {
        const openedAt = documents.current.get(file.id)?.openedAt
        updateSummary({ ...summary, openedAt: Math.max(summary.openedAt ?? 0, openedAt ?? 0) || undefined })
      }
    })
  }, [cache, enqueue, storage, updateSummary])

  const insertImported = useCallback((file: DocumentFile, words: number, original: OriginalFile | undefined, signal: AbortSignal) => {
    return enqueue(async () => {
      const summary = await storage.insertDraft(file, words, original, signal)
      drafts.current.set(file.id, file)
      persisted.current.set(file.id, file)
      updateSummary(summary)
    })
  }, [enqueue, storage, updateSummary])

  const loadFile = useCallback(async (id: string) => {
    if (documents.current.get(id)?.deletedAt !== undefined) return
    const existing = drafts.current.get(id)
    if (existing) return existing
    const file = await storage.readDraft(id)
    if (file && !drafts.current.has(id)) {
      drafts.current.set(id, file)
      persisted.current.set(id, file)
    }
    return drafts.current.get(id)
  }, [storage])

  const opened = useCallback((id: string) => {
    const summary = documents.current.get(id)
    if (!summary) return
    const openedAt = Date.now()
    updateSummary({ ...summary, openedAt })
    return enqueue(() => storage.touchDocument(id, openedAt))
  }, [enqueue, storage, updateSummary])

  const forget = useCallback((id: string) => {
    drafts.current.delete(id)
    persisted.current.delete(id)
    newIds.current.delete(id)
  }, [])

  return { library, layout, documents, workspace, drafts, persisted, writing, enqueue, updateSummary, loadCollection, changeLayout, cache, persist, insertImported, loadFile, opened, forget }
}
