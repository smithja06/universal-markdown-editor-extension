import 'fake-indexeddb/auto'
import { beforeAll, expect, it } from 'vitest'
import { newDocument } from './workspace'
import { loadLibrary, loadLayout, readDraft, insertDraft, writeDraft, trashDocument, recoverDocument, storeLayout } from './workspaceStorage'
import { readVersion, recordVersion, restoreVersion } from './versions'
import { spreadsheetContent } from './formats/content'
import { createWorkbook } from './formats/spreadsheet/model'

const legacy = { id: 'legacy-draft', title: 'Legacy', savedTitle: 'Legacy', source: '# Draft\n', savedSource: '', bom: true, lineEnding: '\r\n' as const, updated: 1 }

beforeAll(async () => {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('folio-workspace', 2)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('sessions').put({ currentId: legacy.id, files: [legacy] }, 'current')
      const versions = db.createObjectStore('document-versions', { keyPath: 'id' })
      versions.createIndex('document-date', ['documentId', 'createdAt'], { unique: true })
      versions.createIndex('document-kind-date', ['documentId', 'kind', 'createdAt'])
      versions.put({ id: 'legacy-version', documentId: legacy.id, createdAt: legacy.updated, kind: 'manual', title: legacy.title, bytes: 7 })
      db.createObjectStore('version-content').put({ source: '# Prior', bom: true, lineEnding: '\r\n' }, 'legacy-version')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the legacy workspace fixture.'))
  })
  connection.close()
})

it('migrates existing drafts and the active tab without changing identity or encoding', async () => {
  expect(await readDraft(legacy.id)).toEqual(legacy)
  expect(await loadLibrary()).toContainEqual(expect.objectContaining({ id: legacy.id, title: 'Legacy' }))
  expect(await loadLayout()).toMatchObject({ activeId: legacy.id, tabs: [{ id: legacy.id, mode: 'visual' }] })
  expect(await readVersion(legacy.id, 'legacy-version')).toMatchObject({ kind: 'manual', content: { source: '# Prior', bom: true, lineEnding: '\r\n' } })
})

it('persists drafts and layout independently even when document names collide', async () => {
  const first = newDocument('Same name')
  const second = newDocument('Same name')
  await Promise.all([insertDraft(first), insertDraft(second)])
  const layout = { activeId: second.id, tabs: [{ id: first.id, mode: 'source' as const }, { id: second.id, mode: 'split' as const }], closed: [] }
  await Promise.all([storeLayout(layout), writeDraft({ ...first, source: 'first', updated: first.updated + 1 }), writeDraft({ ...second, source: 'second', updated: second.updated + 1 })])
  expect(await loadLayout()).toEqual(layout)
  expect((await readDraft(first.id))?.source).toBe('first')
  expect((await readDraft(second.id))?.source).toBe('second')
})

it('keeps a trashed draft recoverable and rejects writes from its earlier lifecycle', async () => {
  const file = newDocument('Recover me', { source: '# Draft', bom: false, lineEnding: '\n' })
  await insertDraft(file)
  await trashDocument(file.id)
  expect(await readDraft(file.id)).toBeUndefined()
  expect((await loadLibrary()).find(item => item.id === file.id)?.deletedAt).toBeDefined()
  const stale = { ...file, source: 'Old view tried to overwrite this draft', updated: file.updated + 10_000 }
  await expect(writeDraft(stale)).rejects.toThrow('Trash')
  await recoverDocument(file.id)
  await expect(writeDraft(stale)).rejects.toThrow('changed')
  expect(await readDraft(file.id)).toMatchObject({ id: file.id, title: file.title, source: file.source })
})

it('keeps the complete library and rejects stale edits based on an earlier saved revision', async () => {
  const collection = Array.from({ length: 45 }, (_, index) => newDocument('File ' + index))
  await Promise.all(collection.map(file => insertDraft(file)))
  const [first] = collection
  const latest = { ...first, source: 'Committed by another window', updated: first.updated + 1 }
  await writeDraft(latest, 4, first)
  await expect(writeDraft({ ...first, source: 'Stale content', updated: first.updated + 10_000 }, 2, first)).rejects.toThrow('changed')
  expect(await readDraft(first.id)).toEqual(latest)
  const summaries = await loadLibrary()
  const ids = new Set(summaries.map(item => item.id))
  expect(collection.every(file => ids.has(file.id))).toBe(true)
  expect(summaries.every(item => !('source' in item))).toBe(true)
})

it('stores spreadsheet cell edits and original bytes with recoverable history and rejects competing revisions', async () => {
  const workbook = createWorkbook('csv')
  workbook.sheets[0].cells.A1 = { kind: 'text', value: '0123' }
  const bytes = new Blob(['0123'])
  const reference = { id: crypto.randomUUID(), filename: 'catalog.csv', sha256: 'fixture', byteLength: bytes.size }
  const first = newDocument(reference.filename, { ...spreadsheetContent('csv', workbook), originalFile: reference })
  await insertDraft(first, undefined, { reference, bytes })
  const initial = (await recordVersion(first, 'manual')).version
  const revised = structuredClone(workbook)
  revised.sheets[0].cells.A1.value = '0999'
  const latest = { ...first, workbook: revised, updated: first.updated + 1 }
  await writeDraft(latest, undefined, first)
  const concurrent = structuredClone(first)
  concurrent.updated += 100
  await expect(writeDraft(concurrent, undefined, first)).rejects.toThrow('changed')
  const restored = await restoreVersion(latest, initial.id, latest)
  expect(restored).toMatchObject({ format: 'csv', workbook, originalFile: reference })
  expect(await readDraft(first.id)).toEqual(restored)
})
