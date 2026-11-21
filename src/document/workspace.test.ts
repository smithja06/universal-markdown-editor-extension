import { expect, it, vi } from 'vitest'
import { createWorkspace, normalizeAppearance } from './workspace'

it('keeps host-local view state and writes only appearance preferences', () => {
  const write = vi.fn()
  const preferences = { read: () => normalizeAppearance({ theme: 'system', splitRatio: 0.65 }, true), write }
  const first = createWorkspace(preferences, false)
  const other = createWorkspace(preferences, true)

  first.getState().setMode('split')
  first.getState().setSidebar(true)
  expect(other.getState()).toMatchObject({ mode: 'visual', sidebar: true })
  expect(write).not.toHaveBeenCalled()

  first.getState().setAppearance({ splitRatio: 0.6 })
  expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ theme: 'dark', splitRatio: 0.6 }))
  expect(other.getState().appearance.splitRatio).toBe(0.65)
})
