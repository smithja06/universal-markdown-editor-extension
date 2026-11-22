import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

const temp = resolve(process.env.FOLIO_LOCAL_FS_PROBE_DIR || tmpdir())
const prefix = 'folio-attachment-'
const strictQualification = process.env.FOLIO_QUALIFY_LOCAL_FS === '1'
let fixture: string

function unsupportedPrimitive(error: unknown, windowsCode: string) {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return false
  return ['EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error.code) ||
    (process.platform === 'win32' && error.code === windowsCode)
}

beforeEach(async () => { fixture = await mkdtemp(join(temp, prefix)) })
afterEach(async () => {
  if (fixture && dirname(fixture) === temp && basename(fixture).startsWith(prefix)) {
    await rm(fixture, { recursive: true, force: true })
  }
})

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

  await rename(checked, join(fixture, 'original-assets'))
  try { await symlink(sibling, checked, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    if (!strictQualification && unsupportedPrimitive(error, 'EINVAL')) skip('Directory links are unavailable in the test temp directory.')
    throw error
  }
  const stage = join(checked, '.stage')
  await writeFile(stage, 'bytes', { flag: 'wx' })

  expect(await lstat(checked).then(info => info.isSymbolicLink())).toBe(true)
  expect(await readFile(join(sibling, '.stage'), 'utf8')).toBe('bytes')
})
