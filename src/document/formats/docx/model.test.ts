// @vitest-environment node
import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { canonicalDocx, docxMaxWorkspaceSnapshot, readDocxSnapshot, safeDocxLink } from './model'
import { newDocument } from '../../workspace'
import { insertDraft, readDraft, readOriginal, writeDraft } from '../../workspaceStorage'
import { readVersion, recordVersion, restoreVersion } from '../../versions'
import { makeDocxContent } from '../content'
import { exportDocument } from '../registry'

const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'literal # & café 🙂' }] }] }

test('normalizes default editor attributes and adjacent runs without dropping supported marks', () => {
  expect(canonicalDocx({ type: 'doc', attrs: { frontMatter: '' }, content: [{
    type: 'paragraph', attrs: { textAlign: null, sourceId: null }, content: [
      { type: 'text', text: 'one ', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { type: 'text', text: 'two', marks: [{ type: 'italic' }, { type: 'bold' }] },
      { type: 'hardBreak' },
    ],
  }] })).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'one two', marks: [{ type: 'bold' }, { type: 'italic' }] }, { type: 'hardBreak' },
  ] }] })
})

test('rejects unsupported formatting, nested content and unsafe destinations', () => {
  expect(() => canonicalDocx({ type: 'doc', content: [{ type: 'paragraph', attrs: { lineSpacing: '20px' } }] })).toThrow()
  expect(() => canonicalDocx({ type: 'doc', content: [{ type: 'blockquote', content: body.content }] })).toThrow()
  expect(safeDocxLink('https://example.com/path?q=a&b=c')).toBe(true)
  expect(safeDocxLink('javascript:alert(1)')).toBe(false)
  expect(safeDocxLink('https://user@example.com')).toBe(false)
  expect(safeDocxLink('//example.com')).toBe(false)
})

test('workspace snapshot validation rejects oversized and noncanonical transactions', () => {
  expect(readDocxSnapshot(JSON.stringify(body))).toEqual(body)
  expect(() => readDocxSnapshot(JSON.stringify({ ...body, metadata: 'unknown' }))).toThrow('invalid DOCX draft')
  expect(() => readDocxSnapshot(JSON.stringify({ type: 'doc', content: [{ type: 'image' }] }))).toThrow('supported subset')
  expect(() => readDocxSnapshot(' '.repeat(docxMaxWorkspaceSnapshot + 1))).toThrow('workspace editing limit')
})

test('stores rich version changes independently of text and recovers the original relationship', async () => {
  const original = { reference: { id: 'docx-fixture', filename: 'fixture.docx', byteLength: 3, sha256: 'test' }, bytes: new Blob(['abc']) }
  const before = newDocument('fixture.docx', { ...makeDocxContent(body, []), originalFile: original.reference })
  if (before.format !== 'docx') throw new Error('Expected a DOCX draft.')
  await insertDraft(before, undefined, original)
  const { version: first } = await recordVersion(before, 'manual')
  const bold = canonicalDocx({ type: 'doc', content: [{ type: 'paragraph', content: [{ ...body.content[0].content[0], marks: [{ type: 'bold' }] }] }] })
  const edited = { ...before, ...makeDocxContent(bold, []), originalFile: original.reference, updated: before.updated + 1 }
  await writeDraft(edited, undefined, before)
  const { version: second } = await recordVersion(edited, 'manual')
  expect(second.id).not.toBe(first.id)
  await expect(writeDraft({ ...before, updated: edited.updated }, undefined, before)).rejects.toThrow('changed')
  expect((await readVersion(before.id, second.id))?.content).toMatchObject({ document: bold })
  const restored = await restoreVersion(edited, first.id, edited)
  expect(await readDraft(before.id)).toEqual(restored)
  expect(restored).toMatchObject({ document: body, originalFile: original.reference })
  expect(await (await readOriginal(original.reference.id))?.text()).toBe('abc')
})

test('DOCX loss review reports feature and location, and stale or cancelled confirmations never deliver', async () => {
  const content = makeDocxContent(body, [{ code: 'header', feature: 'Header', location: 'Section 1', effect: 'omitted', message: 'The header remains in the original.' }])
  const snapshot = { id: 'word', revision: 1, title: 'fixture', content }
  const read = async () => undefined
  const deliver = () => { throw new Error('No file should be delivered.') }
  const review = await exportDocument(snapshot, () => true, read, deliver)
  expect(review).toMatchObject({ status: 'needs-confirmation', diagnostics: [{ feature: 'Header', location: 'Section 1', effect: 'omitted' }, { feature: 'Page layout and styles' }] })
  expect(await exportDocument(snapshot, () => false, read, deliver, { confirmDocx: true })).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'stale-export' }] })
  const controller = new AbortController()
  const pending = exportDocument(snapshot, () => true, read, deliver, { confirmDocx: true }, controller.signal, {
    read: async () => { throw new Error('Unexpected read.') },
    write: async () => { controller.abort(); return new Uint8Array([1, 2, 3]) },
  })
  await expect(pending).rejects.toThrow('aborted')
})
