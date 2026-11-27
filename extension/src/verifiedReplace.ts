import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, stat, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * libuv's `UV_FS_O_EXLOCK`. On Windows it opens the file with share mode 0, so while Folio holds the handle no other
 * process can open, write, delete, rename away or rename over the file. Node does not export the constant.
 */
export const windowsExclusiveLock = 0x10000000

export class ReplaceConflictError extends Error {}
export class ReplaceBusyError extends Error {}

export type JournalState = 'completed' | 'untouched' | 'interrupted' | 'external'

export interface SaveJournal {
  version: 1
  path: string
  expected: string
  next: string
  created: number
  previous: Uint8Array<ArrayBuffer>
  replacement: Uint8Array<ArrayBuffer>
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const code = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code

function pathKey(path: string) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function journalPath(directory: string, path: string) {
  return join(directory, `folio-save-${createHash('sha256').update(pathKey(path)).digest('hex').slice(0, 32)}.journal`)
}

export function encodeJournal(journal: SaveJournal) {
  const header = Buffer.from(JSON.stringify({
    version: journal.version, path: journal.path, expected: journal.expected, next: journal.next, created: journal.created,
    previous: journal.previous.byteLength, replacement: journal.replacement.byteLength,
  }))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(header.byteLength)
  return Buffer.concat([length, header, journal.previous, journal.replacement])
}

export function decodeJournal(data: Uint8Array): SaveJournal {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const size = buffer.byteLength >= 4 ? buffer.readUInt32LE(0) : 0
  if (size < 2 || size > 64 * 1024 || 4 + size > buffer.byteLength) throw new Error('The save journal is damaged.')
  const header: unknown = JSON.parse(buffer.subarray(4, 4 + size).toString('utf8'))
  const record = header as Record<string, unknown>
  if (!record || record.version !== 1 || typeof record.path !== 'string' || typeof record.expected !== 'string' ||
    typeof record.next !== 'string' || typeof record.created !== 'number' || !Number.isSafeInteger(record.previous) ||
    !Number.isSafeInteger(record.replacement) || 4 + size + (record.previous as number) + (record.replacement as number) !== buffer.byteLength) {
    throw new Error('The save journal is damaged.')
  }
  const start = 4 + size
  const previous = Uint8Array.from(buffer.subarray(start, start + (record.previous as number)))
  const replacement = Uint8Array.from(buffer.subarray(start + (record.previous as number)))
  if (digest(previous) !== record.expected || digest(replacement) !== record.next) throw new Error('The save journal failed verification.')
  return { version: 1, path: record.path, expected: record.expected, next: record.next, created: record.created, previous, replacement }
}

/** Writes and flushes a journal under a fresh name, then renames it into the single slot for this document. */
async function writeJournal(directory: string, journal: SaveJournal) {
  await mkdir(directory, { recursive: true })
  const target = journalPath(directory, journal.path)
  const staging = `${target}.${process.pid}.${Date.now()}.tmp`
  const handle = await open(staging, 'wx')
  try {
    await handle.writeFile(encodeJournal(journal))
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(staging).catch(() => undefined)
    throw error
  }
  await handle.close()
  await rename(staging, target)
  return target
}

export async function readJournal(directory: string, path: string) {
  try { return decodeJournal(await readFile(journalPath(directory, path))) }
  catch (error) {
    if (code(error) === 'ENOENT') return undefined
    throw error
  }
}

export async function removeJournal(directory: string, path: string) {
  await unlink(journalPath(directory, path)).catch(error => { if (code(error) !== 'ENOENT') throw error })
}

/**
 * Classifies the current file against an unfinished save. A Folio write that stopped part way leaves every byte equal
 * to the previous or the replacement bytes at that offset, with a length between the two. Anything else came from
 * another writer and must be treated as an external change.
 */
export function classifyJournal(current: Uint8Array | undefined, journal: SaveJournal): JournalState {
  if (!current) return 'external'
  const hash = digest(current)
  if (hash === journal.next) return 'completed'
  if (hash === journal.expected) return 'untouched'
  const { previous, replacement } = journal
  const longest = Math.max(previous.byteLength, replacement.byteLength)
  if (current.byteLength < Math.min(previous.byteLength, replacement.byteLength) || current.byteLength > longest) return 'external'
  for (let index = 0; index < current.byteLength; index++) {
    const byte = current[index]
    if ((index >= replacement.byteLength || byte !== replacement[index]) && (index >= previous.byteLength || byte !== previous[index])) return 'external'
  }
  return 'interrupted'
}

async function openExclusive(path: string, attempts: number) {
  for (let attempt = 1; ; attempt++) {
    try { return await open(path, constants.O_RDWR | windowsExclusiveLock) }
    catch (error) {
      const reason = code(error)
      if (reason === 'ENOENT') throw new ReplaceConflictError('The file was moved or deleted after Folio opened it.', { cause: error })
      if ((reason === 'EBUSY' || reason === 'EPERM') && attempt < attempts) { await delay(80 * attempt); continue }
      if (reason === 'EBUSY') throw new ReplaceBusyError('Another app has this file open. Close it there and save again.', { cause: error })
      if (reason === 'EPERM' || reason === 'EACCES') throw new ReplaceBusyError('VS Code cannot write this file. It may be read-only, locked or protected.', { cause: error })
      throw error
    }
  }
}

async function readAll(handle: FileHandle, size: number) {
  const bytes = new Uint8Array(size + 1)
  let offset = 0
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return bytes.subarray(0, offset)
}

const chunkBytes = 1024 * 1024

/** Writes in bounded chunks, then truncates and flushes. `faults` lets tests fail a chunk or the flush. */
async function writeAll(handle: FileHandle, bytes: Uint8Array, faults?: ReplaceFaults) {
  let offset = 0
  while (offset < bytes.byteLength) {
    await faults?.chunk?.(offset, handle)
    const length = Math.min(faults?.chunkBytes ?? chunkBytes, bytes.byteLength - offset)
    const { bytesWritten } = await handle.write(bytes, offset, length, offset)
    if (bytesWritten <= 0) throw new Error('The disk accepted no more bytes.')
    offset += bytesWritten
  }
  await handle.truncate(bytes.byteLength)
  await faults?.flush?.()
  await handle.sync()
}

/** Test-only fault injection for the replacement write. The restore write never uses it. */
export interface ReplaceFaults {
  /** Called before each chunk is written, with the offset reached so far. Throw to simulate a failing disk. */
  chunk?: (offset: number, handle: FileHandle) => Promise<void> | void
  /** Called before the replacement is flushed. Throw to simulate a failed flush. */
  flush?: () => Promise<void> | void
  chunkBytes?: number
}

export interface ReplaceOptions {
  /** Folio's private storage for the crash journal. It must be on a local disk. */
  journalDirectory: string
  /** Largest file Folio accepts as the existing document. */
  limit: number
  /** Called after the lock and fingerprint check, immediately before the first write. Throw to abandon the save. */
  beforeWrite?: () => void
  /** Test hook that runs after the replacement bytes are written and before they are verified. */
  afterWrite?: (handle: FileHandle) => Promise<void>
  faults?: ReplaceFaults
  attempts?: number
}

/**
 * Replaces `path` only if its current content still has SHA-256 `expected`. The comparison and the write happen through
 * one exclusive Windows handle, so no other process can change, replace or move the file between them. The replacement
 * is journaled first, written in place, flushed and read back. On failure Folio writes the previous bytes back through the
 * same handle. If the process stops mid-write, the journal lets the next open classify and recover the file.
 */
export async function replaceVerified(path: string, expected: string, bytes: Uint8Array<ArrayBuffer>, options: ReplaceOptions) {
  if (process.platform !== 'win32') throw new Error('Folio replaces existing files only on qualified Windows volumes.')
  const linked = await lstat(path).catch(error => {
    if (code(error) === 'ENOENT') throw new ReplaceConflictError('The file was moved or deleted after Folio opened it.', { cause: error })
    throw error
  })
  if (linked.isSymbolicLink() || !linked.isFile()) throw new ReplaceConflictError('Folio saves only regular files, not links or special files.')
  const handle = await openExclusive(path, options.attempts ?? 6)
  let journaled = false
  let written = false
  let committed = false
  let previous: Uint8Array<ArrayBuffer> | undefined
  try {
    const before = await handle.stat()
    const named = await stat(path)
    if (!before.isFile() || before.ino !== named.ino || before.dev !== named.dev) {
      throw new ReplaceConflictError('The file changed identity after Folio opened it.')
    }
    if (before.size > options.limit) throw new ReplaceConflictError('The file on disk grew beyond Folio’s size limit.')
    previous = Uint8Array.from(await readAll(handle, before.size))
    if (previous.byteLength !== before.size || digest(previous) !== expected) {
      throw new ReplaceConflictError('The file on disk changed after Folio opened it. Folio kept your draft and did not save.')
    }
    const next = digest(bytes)
    if (next === expected) {
      committed = true
      await handle.close()
      return { fingerprint: next, unchanged: true }
    }
    await writeJournal(options.journalDirectory, { version: 1, path, expected, next, created: Date.now(), previous, replacement: bytes })
    journaled = true
    options.beforeWrite?.()
    written = true
    await writeAll(handle, bytes, options.faults)
    await options.afterWrite?.(handle)
    const check = await readAll(handle, bytes.byteLength)
    if (check.byteLength !== bytes.byteLength || digest(check) !== next) throw new Error('The saved file did not match the draft when Folio read it back.')
    committed = true
    await handle.close()
    await removeJournal(options.journalDirectory, path).catch(() => undefined)
    // The share mode prevents renames while the handle is open. This detects a parent move that raced the open.
    const after = await stat(path).catch(() => undefined)
    if (!after || after.ino !== before.ino) throw new ReplaceConflictError('The file was moved while Folio saved it. Check where the saved file is.')
    return { fingerprint: next, unchanged: false }
  } catch (error) {
    if (committed) throw error
    const restored = written && previous ? await restorePrevious(handle, previous, expected) : true
    await handle.close().catch(() => undefined)
    if (!restored) {
      throw new Error('Folio could not finish saving or restore the previous file. Reopen it in Folio to recover from the save journal.', { cause: error })
    }
    // The file still holds the previous bytes, untouched or verified after the restore, so this call's journal is not
    // needed. A journal from an earlier interrupted save is left alone when this call never wrote its own.
    if (journaled) await removeJournal(options.journalDirectory, path).catch(() => undefined)
    throw error
  }
}

/** Writes the previous bytes back through the still-locked handle. The journal stays if this cannot be verified. */
async function restorePrevious(handle: FileHandle, previous: Uint8Array, expected: string) {
  try {
    await writeAll(handle, previous)
    return digest(await readAll(handle, previous.byteLength)) === expected
  } catch { return false }
}
