import { link, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { attachmentFilename } from './attachmentPath'

const temp = resolve(process.env.FOLIO_LOCAL_FS_PROBE_DIR || tmpdir())
const prefix = 'folio-attachment-'
const strictQualification = process.env.FOLIO_QUALIFY_LOCAL_FS === '1'
let fixture: string

function errorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  return ''
}

function unsupportedPrimitive(error: unknown, windowsCode: string) {
  const code = errorCode(error)
  return ['EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(code) ||
    (process.platform === 'win32' && code === windowsCode)
}

beforeEach(async () => { fixture = await mkdtemp(join(temp, prefix)) })
afterEach(async () => {
  if (fixture && dirname(fixture) === temp && basename(fixture).startsWith(prefix)) {
    await rm(fixture, { recursive: true, force: true })
  }
})

async function replaceParent(destination: string, sibling: string, original: string) {
  await rename(destination, original)
  await symlink(sibling, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

it('creates a staging name exclusively and preserves the winning bytes', async () => {
  const stage = join(fixture, '.stage')
  const contents = ['first bytes', 'second bytes']
  const writes = await Promise.allSettled(contents.map(bytes => writeFile(stage, bytes, { flag: 'wx', mode: 0o600 })))

  expect(writes.filter(result => result.status === 'rejected')).toEqual([
    expect.objectContaining({ reason: expect.objectContaining({ code: 'EEXIST' }) }),
  ])
  const winner = writes.findIndex(result => result.status === 'fulfilled')
  expect(await readFile(stage, 'utf8')).toBe(contents[winner])
})

it('publishes one complete stage at a contested final name and preserves both payloads', async ({ skip }) => {
  const stages = ['.stage-a', '.stage-b'].map(name => join(fixture, name))
  const contents = ['first bytes', 'second bytes']
  const final = join(fixture, 'image.png')
  await Promise.all(stages.map((stage, index) => writeFile(stage, contents[index], { flag: 'wx' })))
  const publications = await Promise.allSettled(stages.map(stage => link(stage, final)))
  if (!strictQualification && publications.every(result => result.status === 'rejected' && unsupportedPrimitive(result.reason, 'EISDIR'))) {
    skip('Hard links are unavailable in the test temp directory.')
  }

  expect(publications.filter(result => result.status === 'rejected')).toEqual([
    expect.objectContaining({ reason: expect.objectContaining({ code: 'EEXIST' }) }),
  ])
  const winner = publications.findIndex(result => result.status === 'fulfilled')
  const loser = 1 - winner
  const published = await lstat(final, { bigint: true })
  const staged = await lstat(stages[winner], { bigint: true })
  expect([published.dev, published.ino]).toEqual([staged.dev, staged.ino])
  await unlink(stages[winner])
  expect(await readFile(final, 'utf8')).toBe(contents[winner])

  const alternate = join(fixture, 'image-2.png')
  expect(await readFile(stages[loser], 'utf8')).toBe(contents[loser])
  await link(stages[loser], alternate)
  expect(await readFile(alternate, 'utf8')).toBe(contents[loser])
})

it('shows that an exclusive leaf create can follow a replaced parent even after realpath', async ({ skip }) => {
  const destination = join(fixture, 'workspace', 'assets')
  const sibling = join(fixture, 'other-root')
  await mkdir(destination, { recursive: true })
  await mkdir(sibling)
  const checked = await realpath(destination)
  expect(await lstat(checked).then(info => info.isSymbolicLink())).toBe(false)

  try { await replaceParent(checked, sibling, join(fixture, 'original-assets')) }
  catch (error) {
    if (!strictQualification && unsupportedPrimitive(error, 'EINVAL')) skip('Directory links are unavailable in the test temp directory.')
    throw error
  }
  const stage = join(checked, '.stage')
  await writeFile(stage, 'bytes', { flag: 'wx' })

  expect(await lstat(checked).then(info => info.isSymbolicLink())).toBe(true)
  expect(await readFile(join(sibling, '.stage'), 'utf8')).toBe('bytes')
})

it('shows that path-based publication can follow a swapped parent after stage identity verification', async ({ skip }) => {
  const assets = join(fixture, 'workspace', 'assets')
  const outside = join(fixture, 'other-root')
  const original = join(fixture, 'original-assets')
  await mkdir(assets, { recursive: true })
  await mkdir(outside)
  const stage = join(assets, '.stage')
  await writeFile(stage, 'verified bytes', { flag: 'wx' })
  await writeFile(join(outside, '.stage'), 'unrelated bytes', { flag: 'wx' })
  const checked = await realpath(assets)
  const identity = await lstat(stage, { bigint: true })
  try { await replaceParent(checked, outside, original) }
  catch (error) {
    if (!strictQualification && unsupportedPrimitive(error, 'EINVAL')) skip('Directory links are unavailable in the test temp directory.')
    throw error
  }
  try { await link(stage, join(assets, 'image.png')) }
  catch (error) {
    if (!strictQualification && unsupportedPrimitive(error, 'EISDIR')) skip('Hard links are unavailable in the test temp directory.')
    throw error
  }
  const published = join(outside, 'image.png')
  const originalStage = await lstat(join(original, '.stage'), { bigint: true })
  expect([originalStage.dev, originalStage.ino]).toEqual([identity.dev, identity.ino])
  expect(await readFile(published, 'utf8')).toBe('unrelated bytes')
})

it('shows that checking a stage identity before path-based cleanup can still delete a replacement', async () => {
  const stage = join(fixture, '.stage')
  const original = join(fixture, '.moved-stage')
  await writeFile(stage, 'operation bytes', { flag: 'wx' })
  const identity = await lstat(stage, { bigint: true })
  await rename(stage, original)
  await writeFile(stage, 'another operation', { flag: 'wx' })
  expect((await lstat(stage, { bigint: true })).ino).not.toBe(identity.ino)
  await unlink(stage)
  expect(await readdir(fixture)).toEqual(['.moved-stage'])
  expect(await readFile(original, 'utf8')).toBe('operation bytes')
})

it.skipIf(process.platform !== 'win32')('shows NTFS can publish beside a canonically equivalent name added after enumeration', async ({ skip }) => {
  const stage = join(fixture, '.stage')
  await writeFile(stage, 'staged bytes', { flag: 'wx' })
  const candidate = attachmentFilename('caf\u00e9.png', 'png', await readdir(fixture))!
  expect(candidate).toBe('caf\u00e9.png')
  const lateArrival = join(fixture, 'cafe\u0301.png')
  await writeFile(lateArrival, 'competing bytes', { flag: 'wx' })
  try { await link(stage, join(fixture, candidate)) }
  catch (error) {
    if (!strictQualification && errorCode(error) === 'EEXIST') skip('The test volume already treats the two spellings as one name.')
    if (!strictQualification && unsupportedPrimitive(error, 'EISDIR')) skip('Hard links are unavailable in the test temp directory.')
    throw error
  }
  expect(await readFile(lateArrival, 'utf8')).toBe('competing bytes')
  expect(await readFile(join(fixture, candidate), 'utf8')).toBe('staged bytes')
})
