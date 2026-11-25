// @vitest-environment node
import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'
import { recordVersion, readVersion, restoreVersion } from '../versions'
import { newDocument } from '../workspace'
import { insertDraft, originalsStore, readDraft, readOriginal, writeDraft } from '../workspaceStorage'
import { exportDocument, identifyFormat, importDocument, type ExportSnapshot } from './registry'

const encoder = new TextEncoder()
const input = (name: string, bytes: Uint8Array<ArrayBuffer>) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer })

test.each(['\n', '\r\n', '\r'])('preserves UTF-8 BOM, Unicode, whitespace and %j on TXT round trips', async lineEnding => {
  const text = ['# café 😀', '\t**literal**  ', '', ''].join(lineEnding)
  const bytes = encoder.encode('\ufeff' + text)
  const imported = await importDocument(input('example.TXT', bytes))
  if (imported.status !== 'editable' || imported.content.format !== 'txt' || !imported.original) throw new Error('Expected a TXT draft with original bytes.')
  expect(imported.content).toMatchObject({ source: text.replace(/\r\n?/g, '\n'), bom: true, lineEnding, mixedLineEndings: false })
  expect(imported.original.reference.sha256).toMatch(/^[a-f0-9]{64}$/)
  const { content, original } = imported
  const delivered: Uint8Array[] = []
  const deliver = (_: string, value: Uint8Array) => delivered.push(value)
  const read = async () => original.bytes
  expect(await exportDocument({ id: 'file', revision: 1, title: 'example', content }, () => true, read, deliver)).toMatchObject({ status: 'downloaded' })
  expect(delivered[0]).toEqual(bytes)
  await exportDocument({ id: 'file', revision: 2, title: 'example', content: { ...content, source: 'edited\n\n' } }, () => true, read, deliver)
  expect(delivered[1]).toEqual(encoder.encode('\ufeffedited' + lineEnding.repeat(2)))
})

test.each(['', 'single trailing space ', '\ufeff', '\ufeff\ufeffA', '\t\v\f\r'])('preserves the exact bytes of %j', async text => {
  const bytes = encoder.encode(text)
  const imported = await importDocument(input('text.txt', bytes))
  if (imported.status !== 'editable') throw new Error('Expected the fixture to import.')
  const delivered: Uint8Array[] = []
  await exportDocument({ id: 'file', revision: 1, title: 'text', content: imported.content }, () => true, async () => imported.original?.bytes, (_, result) => delivered.push(result))
  expect(delivered).toEqual([bytes])
})

test('rejects invalid UTF-8, UTF-16, binary-looking data, and unsupported formats', async () => {
  for (const bytes of [[0xc3, 0x28], [0xff, 0xfe, 0x61, 0], [0x61, 0x00, 0x62]]) {
    expect(await importDocument(input('bad.txt', Uint8Array.from(bytes)))).toMatchObject({ status: 'rejected', diagnostics: [{ severity: 'error' }] })
  }
  expect(identifyFormat('note.MarkDown')).toBe('markdown')
  expect(identifyFormat('note.TXT')).toBe('txt')
  expect(await importDocument(input('note.docx', encoder.encode('text')))).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'unsupported-format' }] })
})

test('mixed newlines require a choice only after editing and a stale export cannot deliver', async () => {
  const bytes = encoder.encode('one\r\ntwo\rthree\n')
  const imported = await importDocument(input('mixed.txt', bytes))
  if (imported.status !== 'editable' || imported.content.format !== 'txt' || !imported.original) throw new Error('Expected a mixed TXT draft.')
  const { content, original } = imported
  const snapshot: ExportSnapshot = { id: 'file', revision: 3, title: 'mixed.txt', content: { ...content, source: 'edited\ntext\n' } }
  let revision = 3
  const isCurrent = (candidate: ExportSnapshot) => candidate.revision === revision
  const noDownload = () => { throw new Error('No file should be downloaded.') }
  const read = async () => original.bytes
  expect(await exportDocument(snapshot, isCurrent, read, noDownload)).toMatchObject({ status: 'needs-options', diagnostics: [{ code: 'mixed-line-endings' }] })
  expect(await exportDocument(snapshot, isCurrent, async () => { revision++; return original.bytes }, noDownload, { lineEnding: '\r' })).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'stale-export' }] })

  revision = 3
  const delivered: Uint8Array[] = []
  await exportDocument(snapshot, isCurrent, read, (_, result) => delivered.push(result), { lineEnding: '\r' })
  expect(delivered).toEqual([encoder.encode('edited\rtext\r')])
  await exportDocument({ ...snapshot, content }, isCurrent, read, (_, result) => delivered.push(result))
  expect(delivered[1]).toEqual(bytes)
})

test('rejects edited text with invalid Unicode before encoding', async () => {
  const imported = await importDocument(input('text.txt', encoder.encode('valid')))
  if (imported.status !== 'editable') throw new Error('Expected a TXT draft.')
  const snapshot = { id: 'file', revision: 2, title: 'text', content: { ...imported.content, source: '\uD800' } }
  expect(await exportDocument(snapshot, () => true, async () => imported.original?.bytes, () => { throw new Error('No download expected.') })).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'invalid-text' }] })
})

test('rejects an edited BOM-less draft whose leading U+FEFF would be read as a BOM', async () => {
  const result = await importDocument(input('literal.txt', encoder.encode('a\ufeffb')))
  if (result.status !== 'editable') throw new Error('Expected a TXT draft.')
  const snapshot = { id: 'file', revision: 2, title: 'literal', content: { ...result.content, source: '\ufeffb' } }
  expect(await exportDocument(snapshot, () => true, async () => result.original?.bytes, () => { throw new Error('No download expected.') })).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'invalid-text' }] })
})

test('new Markdown drafts and versions carry a format and schema version', async () => {
  const file = newDocument('Markdown')
  await insertDraft(file)
  const { version } = await recordVersion(file, 'manual')
  expect(await readDraft(file.id)).toMatchObject({ format: 'markdown', schemaVersion: 1 })
  expect(await readVersion(file.id, version.id)).toMatchObject({ content: { format: 'markdown', schemaVersion: 1 } })
})

test('stores originals atomically and restores typed versions without changing their lineage', async () => {
  const bytes = encoder.encode('first\r\nsecond\rthird\n')
  const imported = await importDocument(input('source.txt', bytes))
  if (imported.status !== 'editable' || imported.content.format !== 'txt' || !imported.original) throw new Error('Expected a TXT draft.')
  const file = newDocument('source.txt', imported.content)
  const id = imported.original.reference.id
  await expect(insertDraft(file)).rejects.toThrow('original')
  expect(await readDraft(file.id)).toBeUndefined()
  await insertDraft(file, undefined, imported.original)
  const { version } = await recordVersion(file, 'manual')
  const edited = { ...file, source: 'changed', updated: file.updated + 1 }
  await writeDraft(edited, undefined, file)
  await expect(writeDraft({ ...file, updated: file.updated + 100 }, undefined, file)).rejects.toThrow('changed')
  const restored = await restoreVersion(edited, version.id, edited)
  expect(await readVersion(file.id, version.id)).toMatchObject({ content: imported.content })
  expect(await readDraft(file.id)).toEqual(restored)
  expect(new Uint8Array(await (await readOriginal(id))!.arrayBuffer())).toEqual(bytes)
})

test('cancelling an import during the originals write rolls back the complete transaction', async () => {
  const result = await importDocument(input('cancelled.txt', encoder.encode('this draft should not commit')))
  if (result.status !== 'editable' || !result.original) throw new Error('Expected a TXT draft.')
  const file = newDocument('cancelled.txt', result.content)
  const controller = new AbortController()
  const add = IDBObjectStore.prototype.add
  const intercept = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = add.call(this, value, key)
    if (this.name === originalsStore) controller.abort()
    return request
  })
  try {
    await expect(insertDraft(file, undefined, result.original, controller.signal)).rejects.toThrow()
    expect(await readDraft(file.id)).toBeUndefined()
    expect(await readOriginal(result.original.reference.id)).toBeUndefined()
  } finally { intercept.mockRestore() }
})
