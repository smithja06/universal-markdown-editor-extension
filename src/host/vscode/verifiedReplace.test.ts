// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyJournal, decodeJournal, journalPath, readJournal, replaceVerified, ReplaceBusyError, ReplaceConflictError, type SaveJournal,
} from '../../../extension/src/verifiedReplace'

const windows = process.platform === 'win32'
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const bytes = (text: string) => Uint8Array.from(Buffer.from(text))
let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function fixture(content = 'original workbook bytes') {
  directory = await mkdtemp(join(tmpdir(), 'folio-replace-'))
  const file = join(directory, 'Report.docx')
  await writeFile(file, content)
  return { file, journals: join(directory, 'journals'), expected: sha(content) }
}

function powershell(command: string) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${command}`], { encoding: 'utf8' })
}

describe.runIf(windows)('verified in-place replacement on Windows', () => {
  it('replaces a file whose content still matches and removes the journal', async () => {
    const { file, journals, expected } = await fixture()
    const before = await stat(file)
    const result = await replaceVerified(file, expected, bytes('saved by Folio'), { journalDirectory: journals, limit: 1024 })
    expect(result).toEqual({ fingerprint: sha('saved by Folio'), unchanged: false })
    expect(await readFile(file, 'utf8')).toBe('saved by Folio')
    expect((await stat(file)).ino).toBe(before.ino)
    expect(await readJournal(journals, file)).toBeUndefined()
  })

  it('refuses to replace newer external content', async () => {
    const { file, journals, expected } = await fixture()
    await writeFile(file, 'edited in another app')
    await expect(replaceVerified(file, expected, bytes('stale draft'), { journalDirectory: journals, limit: 1024 })).rejects.toBeInstanceOf(ReplaceConflictError)
    expect(await readFile(file, 'utf8')).toBe('edited in another app')
  })

  it('refuses missing files and files over the limit', async () => {
    const { file, journals, expected } = await fixture()
    await expect(replaceVerified(file + '.missing', expected, bytes('x'), { journalDirectory: journals, limit: 1024 })).rejects.toBeInstanceOf(ReplaceConflictError)
    await expect(replaceVerified(file, expected, bytes('x'), { journalDirectory: journals, limit: 4 })).rejects.toBeInstanceOf(ReplaceConflictError)
    expect(await readFile(file, 'utf8')).toBe('original workbook bytes')
  })

  it('reports a file another process holds open and leaves it unchanged', async () => {
    const { file, journals, expected } = await fixture()
    const holder = spawn('powershell.exe', ['-NoProfile', '-Command',
      `$s=[IO.File]::Open('${file}','Open','Read','ReadWrite'); Write-Output ready; Start-Sleep 20; $s.Close()`])
    try {
      await new Promise(resolve => holder.stdout.once('data', resolve))
      await expect(replaceVerified(file, expected, bytes('blocked'), { journalDirectory: journals, limit: 1024, attempts: 2 })).rejects.toBeInstanceOf(ReplaceBusyError)
    } finally {
      holder.kill()
      await new Promise(resolve => holder.once('exit', resolve))
    }
    expect(await readFile(file, 'utf8')).toBe('original workbook bytes')
  }, 30_000)

  it('blocks other writers, deletion and rename-over between the check and the write', async () => {
    const { file, journals, expected } = await fixture()
    const competitor = join(directory!, 'competitor.docx')
    await writeFile(competitor, 'competing save')
    const attempts: string[] = []
    await replaceVerified(file, expected, bytes('Folio draft'), {
      journalDirectory: journals, limit: 1024,
      beforeWrite: () => {
        for (const command of [`[IO.File]::WriteAllText('${file}','external')`, `[IO.File]::Delete('${file}')`,
          `Move-Item -Force -LiteralPath '${competitor}' -Destination '${file}'`]) {
          attempts.push(powershell(command).status === 0 ? 'succeeded' : 'blocked')
        }
      },
    })
    expect(attempts).toEqual(['blocked', 'blocked', 'blocked'])
    expect(await readFile(file, 'utf8')).toBe('Folio draft')
    expect(await readFile(competitor, 'utf8')).toBe('competing save')
  }, 30_000)

  it('writes the previous bytes back when the write cannot be verified', async () => {
    const { file, journals, expected } = await fixture()
    await expect(replaceVerified(file, expected, bytes('a much longer replacement that fails'), {
      journalDirectory: journals, limit: 1024,
      afterWrite: async handle => { await handle.write(Buffer.from('X'), 0, 1, 3) },
    })).rejects.toThrow(/did not match the draft/)
    expect(await readFile(file, 'utf8')).toBe('original workbook bytes')
    expect(await readJournal(journals, file)).toBeUndefined()
  })

  it('leaves a journal that identifies an interrupted save', async () => {
    const { file, journals, expected } = await fixture()
    await expect(replaceVerified(file, expected, bytes('replacement bytes!'), {
      journalDirectory: journals, limit: 1024,
      // Simulates the extension host stopping after a partial write: the hook breaks restoration by closing the handle.
      afterWrite: async handle => {
        const tail = Buffer.from('original workbook bytes').subarray(10)
        await handle.write(tail, 0, tail.length, 10)
        await handle.close()
      },
    })).rejects.toThrow(/save journal/)
    const journal = await readJournal(journals, file)
    expect(journal?.expected).toBe(expected)
    expect(journal && new TextDecoder().decode(journal.replacement)).toBe('replacement bytes!')
    expect(await readFile(file, 'utf8')).toBe('replacemenorkbook bytes')
    expect(classifyJournal(new Uint8Array(await readFile(file)), journal!)).toBe('interrupted')
  })
})

describe('save journal classification', () => {
  const journal: SaveJournal = {
    version: 1, path: 'C:\\w\\a.xlsx', expected: sha('previous content'), next: sha('new!'), created: 1,
    previous: bytes('previous content'), replacement: bytes('new!'),
  }

  it('distinguishes completed, untouched, interrupted and external states', () => {
    expect(classifyJournal(bytes('new!'), journal)).toBe('completed')
    expect(classifyJournal(bytes('previous content'), journal)).toBe('untouched')
    expect(classifyJournal(bytes('new!ious content'), journal)).toBe('interrupted')
    expect(classifyJournal(bytes('neevious content'), journal)).toBe('interrupted')
    expect(classifyJournal(bytes('Somebody else wrote'), journal)).toBe('external')
    expect(classifyJournal(bytes('x'), journal)).toBe('external')
    expect(classifyJournal(undefined, journal)).toBe('external')
  })

  it('rejects damaged journal records', () => {
    expect(() => decodeJournal(bytes('junk'))).toThrow(/damaged/)
    expect(journalPath('C:\\s', 'C:\\W\\A.xlsx')).toBe(journalPath('C:\\s', windows ? 'c:\\w\\a.xlsx' : 'C:\\W\\A.xlsx'))
  })
})
