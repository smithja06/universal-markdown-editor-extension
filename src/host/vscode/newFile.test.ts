// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newFileExists, writeNewFile } from '../../../extension/src/newFile'
import { isClientMessage, isPdfFilename } from './protocol'

let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('PDF copy publication', () => {
  it('creates a new file and never replaces an existing one', async () => {
    directory = await mkdtemp(join(tmpdir(), 'folio-pdf-copy-'))
    const target = join(directory, 'copy.pdf')
    const bytes = new TextEncoder().encode('%PDF-1.7 reviewed')
    await writeNewFile(target, bytes)
    expect(new Uint8Array(await readFile(target))).toEqual(bytes)
    await writeFile(join(directory, 'existing.pdf'), 'keep me')
    await expect(writeNewFile(join(directory, 'existing.pdf'), bytes)).rejects.toThrow(newFileExists)
    expect(await readFile(join(directory, 'existing.pdf'), 'utf8')).toBe('keep me')
    await expect(writeNewFile(join(directory, 'missing', 'copy.pdf'), bytes)).rejects.toThrow(/could not create/)
  })

  it('accepts only bounded single PDF filenames and buffers', () => {
    expect(isPdfFilename('Report.pdf')).toBe(true)
    for (const name of ['../Report.pdf', 'a/b.pdf', 'a\\b.pdf', 'Report.txt', 'CON:.pdf', ' Report.pdf', 'Report .pdf', '.pdf'.padStart(205, 'x')]) expect(isPdfFilename(name)).toBe(false)
    const message = (bytes: ArrayBuffer, filename = 'a.pdf') => ({ type: 'pdfExport', id: 1, revision: 2, filename, bytes })
    expect(isClientMessage(message(new ArrayBuffer(8)))).toBe(true)
    expect(isClientMessage(message(new ArrayBuffer(0)))).toBe(false)
    expect(isClientMessage(message(new ArrayBuffer(8), '../a.pdf'))).toBe(false)
    expect(isClientMessage({ type: 'pdfReload' })).toBe(true)
  })
})
