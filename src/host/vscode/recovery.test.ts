import { expect, it } from 'vitest'
import { createRecoveryJournal, recoveryMarkdown, recoveryPrefix, type RecoveryDraft } from './recovery'

it('keeps workspace copies separate and removes only the matching URI and generation', () => {
  const store = createRecoveryJournal(() => localStorage)
  const draft: RecoveryDraft = {
    id: '15b2df20-4d71-4cfa-a87d-f69dc49dd751', generation: 1, uri: 'file:///notes.md',
    source: '# notes\n', eol: '\r\n', bom: true, reason: 'pending',
  }
  const newest = { ...draft, generation: 2, source: '# notes\n\n  **Keep**\n' }
  store.write('workspace-a', newest)
  store.write('workspace-b', draft)
  localStorage.setItem(recoveryPrefix + 'workspace-a.invalid', '{')
  store.remove('workspace-a', draft)
  store.remove('workspace-a', { ...newest, uri: 'file:///different.md' })
  expect(store.read('workspace-a')).toEqual([newest])
  expect(recoveryMarkdown(newest)).toBe('\uFEFF# notes\r\n\r\n  **Keep**\r\n')
  store.remove('workspace-a', newest)
  expect(store.read('workspace-a')).toEqual([])
  expect(store.read('workspace-b')).toEqual([draft])
})
