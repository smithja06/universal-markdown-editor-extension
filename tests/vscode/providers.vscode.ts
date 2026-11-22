import { expect } from '@playwright/test'
import { test } from './desktop'

test.use({ virtualWorkspace: true })

test('VS Code provider writes can overwrite a stage after the create check', async ({ desktop: { command } }) => {
  const read = (name: string) => command<string | null>('attachmentRead', { name })
  const name = 'candidate.stage'
  const original = 'original payload'
  const replacement = 'replacement payload'
  const options = { create: true, overwrite: true }

  expect(await read(name)).toBeNull()
  expect(await command('attachmentCreate', { name, contents: original })).toEqual({ outcome: 'ok', options })
  expect(await command('attachmentCreate', { name, contents: replacement })).toEqual({ outcome: 'ok', options })
  expect(await read(name)).toBe(replacement)

  expect(await command('attachmentCreate', { name, contents: original, method: 'workspaceEdit' })).toEqual({ applied: false })
  expect(await read(name)).toBe(replacement)
  const contested = 'contested.stage'
  expect(await command('attachmentCreate', {
    name: contested, contents: original, method: 'workspaceEdit', fault: 'concurrent-create',
  })).toMatchObject({ applied: true, options })
  expect(await read(contested)).toBe(original)
})

test('the synthetic provider protects the final name but can report failures after writing', async ({ desktop: { command } }) => {
  const read = (name: string) => command<string | null>('attachmentRead', { name })
  const create = (name: string, contents: string) => command('attachmentCreate', { name, contents })
  const first = 'first.stage'
  const second = 'second.stage'
  const to = 'image.png'
  await create(first, 'first payload')
  await create(second, 'second payload')
  const outcomes = await command<string[]>('attachmentPublish', { first, second, to })
  expect([...outcomes].sort()).toEqual(['FileExists', 'ok'])
  const winner = outcomes[0] === 'ok' ? first : second
  const loser = winner === first ? second : first
  const winnerContents = winner === first ? 'first payload' : 'second payload'
  const loserContents = loser === first ? 'first payload' : 'second payload'
  expect(await read(to)).toBe(winnerContents)
  expect(await read(winner)).toBeNull()
  expect(await read(loser)).toBe(loserContents)

  const alternate = 'image-2.png'
  expect(await command('attachmentPublish', { first: loser, to: alternate, fault: 'lost-publish-reply' })).toEqual(['Unavailable'])
  expect(await read(alternate)).toBe(loserContents)
  expect(await read(loser)).toBeNull()

  const partial = 'partial.stage'
  expect(await command('attachmentCreate', { name: partial, contents: 'incomplete', fault: 'partial-write' }))
    .toMatchObject({ outcome: 'Unavailable' })
  expect(await read(partial)).toBe('inco')
  await command('attachmentDelete', { name: partial })
  expect(await read(partial)).toBeNull()
  expect(await read(to)).toBe(winnerContents)
  expect(await read(alternate)).toBe(loserContents)
})
