import { expect, it, vi } from 'vitest'
import { createSearch } from './browserSearch'

const options = { regex: true, caseSensitive: true, wholeWord: false }

it('reports invalid regex syntax without waiting on a scheduled worker', async () => {
  const start = vi.fn((): Worker => { throw new Error('Worker should not start') })
  const search = createSearch(start)
  await expect(search(['example'], '[', options, new AbortController().signal)).rejects.toThrow('Enter a valid regular expression.')
  expect(start).not.toHaveBeenCalled()
})
