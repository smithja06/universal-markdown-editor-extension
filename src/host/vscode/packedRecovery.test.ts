import { expect, it } from 'vitest'
import { encodeRecoveryBase, recoveryGeneration, unpackRecovery, type PackedRecovery } from '../../../extension/src/packedRecovery'
import { sourceChange } from './protocol'

it('round-trips a self-contained host checkpoint including exact UTF-16 code units and file metadata', () => {
  const original = 'repeat\n'.repeat(18_000) + '\uD800😀'
  const edited = original.replace('repeat', 'changed') + '\n'
  const entry: PackedRecovery = {
    encoding: 'deflate-utf16-v1', id: '15b2df20-4d71-4cfa-a87d-f69dc49dd751', uri: 'file:///draft.md',
    generation: 5, baseRevision: 1, eol: '\r\n', bom: true, base: encodeRecoveryBase(original), change: sourceChange(original, edited),
  }
  const persisted: unknown = JSON.parse(JSON.stringify(entry))
  expect(recoveryGeneration(persisted)).toBe(5)
  expect(unpackRecovery(persisted)).toEqual({ id: entry.id, uri: entry.uri, generation: 5, eol: '\r\n', bom: true, source: edited, reason: 'pending' })
  expect(unpackRecovery({ ...entry, base: { ...entry.base, data: 'broken' } })).toBeUndefined()
  expect(unpackRecovery({ ...entry, change: { from: 0, to: original.length + 1, text: '' } })).toBeUndefined()
})

it('compacts common spans at both ends without splitting a surrogate pair', () => {
  const prefix = 'x'.repeat(4096)
  const suffix = 'y'.repeat(4098)
  expect(sourceChange(prefix + '😀' + suffix, prefix + '😃' + suffix)).toEqual({ from: 4096, to: 4098, text: '😃' })
})
