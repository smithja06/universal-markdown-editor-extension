// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { malformedPdf, passwordPdf, pdfFixture } from '../../../../tests/fixtures/pdfFixtures'
import { nodePdfRuntime } from '../../../../tests/fixtures/pdfRuntime'
import { recordVersion } from '../../versions'
import { newDocument } from '../../workspace'
import { insertDraft, readDraft, readOriginal } from '../../workspaceStorage'
import { sameContent } from '../content'
import { exportDocument, formatCapabilities, identifyFormat, importDocument, openFileTypes } from '../registry'
import { inspectPdf } from './engine'
import { pdfLimits } from './model'

const input = (name: string, bytes: Uint8Array) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer })
const inspect = async (bytes: Uint8Array, signal?: AbortSignal) => inspectPdf(bytes, await nodePdfRuntime(), signal)

describe('PDF import through the format registry', () => {
  it('identifies PDFs by extension and validates their content', async () => {
    expect(identifyFormat('Scan.PDF')).toBe('pdf')
    expect(openFileTypes).toContain('.pdf')
    expect(openFileTypes).toContain('application/pdf')
    expect(formatCapabilities({ format: 'pdf' })).toEqual({ richText: false, exportCopy: false, readOnly: true })
    const bytes = pdfFixture([['One'], ['Two']])
    const imported = await importDocument(input('Report.pdf', bytes), undefined, undefined, inspect)
    if (imported.status !== 'editable' || imported.content.format !== 'pdf' || !imported.original) throw new Error('Expected a PDF document.')
    expect(imported.content).toMatchObject({ format: 'pdf', pageCount: 2, source: '' })
    expect(imported.original.reference).toMatchObject({ filename: 'Report.pdf', byteLength: bytes.length })
    expect(new Uint8Array(await imported.original.bytes.arrayBuffer())).toEqual(bytes)
  })

  it('rejects malformed, encrypted, renamed and oversized files', async () => {
    const message = async (name: string, bytes: Uint8Array) => {
      const result = await importDocument(input(name, bytes), undefined, undefined, inspect)
      return result.status === 'rejected' ? result.diagnostics[0] : undefined
    }
    expect(await message('broken.pdf', malformedPdf())).toMatchObject({ code: 'invalid-pdf' })
    expect(await message('locked.pdf', passwordPdf())).toMatchObject({ code: 'encrypted-pdf', message: expect.stringMatching(/password-protected/) })
    expect(await message('renamed.pdf', new TextEncoder().encode('PK\u0003\u0004word/document.xml'))).toMatchObject({ code: 'invalid-pdf' })
    const huge = { name: 'huge.pdf', size: pdfLimits.fileBytes + 1, arrayBuffer: async () => { throw new Error('Should not read.') } }
    expect(await importDocument(huge, undefined, undefined, inspect)).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'size-limit' }] })
    expect(await importDocument(input('no-engine.pdf', pdfFixture([['x']])))).toMatchObject({ status: 'rejected' })
  })

  it('stores one immutable original, refuses history and never exports a modified PDF', async () => {
    const bytes = pdfFixture([['Stored']])
    const imported = await importDocument(input('Stored.pdf', bytes), undefined, undefined, inspect)
    if (imported.status !== 'editable' || !imported.original) throw new Error('Expected a PDF document.')
    const file = newDocument('Stored.pdf', imported.content)
    await insertDraft(file, 0, imported.original)
    const draft = await readDraft(file.id)
    expect(draft && sameContent(draft, file)).toBe(true)
    expect(new Uint8Array(await (await readOriginal(imported.original.reference.id))!.arrayBuffer())).toEqual(bytes)
    await expect(recordVersion(file, 'manual')).rejects.toThrow(/no version history/)
    const result = await exportDocument({ id: file.id, revision: 1, title: file.title, content: file }, () => true, readOriginal, () => { throw new Error('Should not deliver.') })
    expect(result).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'read-only' }] })
  })
})
