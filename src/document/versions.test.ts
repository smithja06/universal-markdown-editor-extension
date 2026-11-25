import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { decodeMarkdown, encodeMarkdown } from './files'
import { newDocument } from './workspace'
import { insertDraft, loadLayout, readDraft, writeDraft } from './workspaceStorage'
import { automaticVersionLimit, listVersions, readVersion, recordVersion, restoreVersion, versionInterval } from './versions'

const legacyContent = decodeMarkdown(new TextEncoder().encode('\uFEFF# Legacy\r\n\nExact line endings\r\n'))
const legacy = { ...legacyContent, id: 'legacy-history', title: 'Existing file', savedTitle: 'Existing file', savedSource: legacyContent.source, updated: 1 }
const workspace = (file = legacy) => ({ currentId: file.id, files: [file] })

beforeAll(async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('folio-workspace', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('sessions').put(workspace(), 'current')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the legacy versions fixture.'))
  })
  db.close()
})

describe('version storage', () => {
  it('upgrades existing drafts in place and preserves exact Markdown encoding', async () => {
    expect(await readDraft(legacy.id)).toEqual(legacy)
    expect((await loadLayout())?.activeId).toBe(legacy.id)
    const { version } = await recordVersion(legacy, 'checkpoint', 1000)
    const saved = await readVersion(legacy.id, version.id)
    expect(saved).toMatchObject({ id: version.id, documentId: legacy.id, kind: 'automatic', title: legacy.title })
    expect(encodeMarkdown(saved!.content)).toEqual(encodeMarkdown(legacy))
    expect(await readDraft(legacy.id)).toEqual(legacy)
  })

  it('throttles automatic edits, deduplicates unchanged content, and protects explicit versions', async () => {
    const file = newDocument('Draft')
    await insertDraft(file)
    const changed = { ...file, source: 'Edited' }
    const first = await recordVersion(file, 'checkpoint', 1000)
    expect(first.status).toBe('created')
    expect((await recordVersion(changed, 'interval', 1100)).status).toBe('deferred')
    expect((await recordVersion(file, 'interval', 1000 + versionInterval)).status).toBe('existing')
    const second = await recordVersion(changed, 'interval', 1000 + versionInterval)
    expect(second.status).toBe('created')
    const promoted = await recordVersion(changed, 'manual', 1000 + versionInterval)
    expect(promoted).toMatchObject({ status: 'promoted', version: { id: second.version.id, kind: 'manual' } })
    expect((await recordVersion(changed, 'manual', 1000 + versionInterval)).status).toBe('existing')
    const renamed = await recordVersion({ ...changed, title: 'Renamed' }, 'manual', 1000 + versionInterval)
    expect((await listVersions(file.id)).map(item => item.id)).toEqual([renamed.version.id, second.version.id, first.version.id])
    const another = newDocument(file.title)
    expect(await listVersions(another.id)).toEqual([])
    expect(await readVersion(another.id, first.version.id)).toBeUndefined()
  })

  it('commits restored content and a recovery version together without dropping later history', async () => {
    const file = newDocument('Original', { source: '---\ntitle: Before\n---\n\n# Before\n', lineEnding: '\r\n', bom: true })
    await insertDraft(file)
    const older = (await recordVersion(file, 'manual')).version
    const recent = { ...file, title: 'Newer title', source: '# Current draft\n', savedSource: '# Last disk save\n', updated: file.updated + 1 }
    await writeDraft(recent)
    const prior = (await recordVersion({ ...recent, source: '# Intermediate\n' }, 'manual')).version
    const restored = await restoreVersion(recent, older.id, recent)
    expect(restored).toMatchObject({ id: file.id, title: file.title, source: file.source, bom: true, lineEnding: '\r\n', savedSource: recent.savedSource })
    expect(await readDraft(file.id)).toEqual(restored)
    const versions = await listVersions(file.id)
    expect(versions.map(item => item.kind)).toEqual(['recovery', 'manual', 'manual'])
    expect(versions.slice(1).map(item => item.id)).toEqual([prior.id, older.id])
    expect((await readVersion(file.id, versions[0].id))?.content.source).toBe(recent.source)
    await expect(writeDraft({ ...recent, source: 'Stale browser edit', updated: restored.updated + 1 })).rejects.toThrow('changed in another Folio tab')
    expect(await readDraft(file.id)).toEqual(restored)
  })

  it('rolls back the recovery write if saving the restored draft fails', async () => {
    const file = newDocument('Before')
    await insertDraft(file)
    const earlier = (await recordVersion(file, 'manual')).version
    const current = { ...file, source: 'Keep me', updated: file.updated + 1 }
    await writeDraft(current)
    const put = IDBObjectStore.prototype.put
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'document-drafts') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return put.call(this, value, key)
    })
    try { await expect(restoreVersion(current, earlier.id, current)).rejects.toMatchObject({ name: 'QuotaExceededError' }) }
    finally { failure.mockRestore() }
    expect((await listVersions(current.id)).map(item => item.id)).toEqual([earlier.id])
    expect(await readDraft(current.id)).toEqual(current)
  })

  it('keeps manual versions when automatic retention is reached', async () => {
    const file = newDocument('History')
    await insertDraft(file)
    const manual = (await recordVersion(file, 'manual', 100)).version
    for (let index = 1; index <= automaticVersionLimit + 1; index++) {
      await recordVersion({ ...file, source: `Change ${index}` }, 'checkpoint', 100 + index)
    }
    const versions = await listVersions(file.id)
    expect(versions).toHaveLength(automaticVersionLimit + 1)
    expect(versions.at(-1)).toEqual(manual)
    expect(versions[0].kind).toBe('automatic')
  })

  it('deduplicates simultaneous writes and guards against a different saved draft at the same timestamp', async () => {
    const file = newDocument('Shared draft')
    await insertDraft(file)
    const results = await Promise.all([recordVersion(file, 'manual'), recordVersion(file, 'manual')])
    expect(results.map(result => result.status)).toEqual(['created', 'existing'])
    const persisted = { ...file, source: 'A draft saved elsewhere' }
    await writeDraft(persisted)
    await expect(restoreVersion(file, results[0].version.id, file)).rejects.toThrow('another Folio tab')
    expect(await listVersions(file.id)).toHaveLength(1)
    expect(await readDraft(file.id)).toEqual(persisted)
  })
})
