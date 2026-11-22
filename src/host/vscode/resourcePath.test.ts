import { expect, it } from 'vitest'
import { resolveWorkspacePath } from './resourcePath'

it('resolves document-relative and workspace-root paths without choosing a scheme or authority', () => {
  expect(resolveWorkspacePath('/workspace/docs/current.md', '/workspace', '../media/fig%20one.png')).toEqual({ path: '/workspace/media/fig one.png', fragment: '' })
  expect(resolveWorkspacePath('/workspace/docs/current.md', '/workspace', '/notes.md#one%20two')).toEqual({ path: '/workspace/notes.md', fragment: 'one two' })
  expect(resolveWorkspacePath('/workspace/docs/current.md', '/workspace', './a%23b.md#two')).toEqual({ path: '/workspace/docs/a#b.md', fragment: 'two' })
  expect(resolveWorkspacePath('/note.md', '/', 'asset.png')).toEqual({ path: '/asset.png', fragment: '' })
})

it.each(['../../secret.png', '/../outside.md', '%2e%2e/%2e%2e/secret.png', 'a%2fb.png', 'a%5Cb.png', '//server/a.png', 'file:/secret.md', 'https://host/a.png', 'command:run.md', 'a.png?x=1', '%00a.png', '#heading', 'C:\\a.md', 'a%FF.md'])('rejects unsafe or unsupported references %s', reference => {
  expect(resolveWorkspacePath('/workspace/docs/current.md', '/workspace', reference)).toBeUndefined()
})

it('rejects Windows alias and traversal segments and accepts a case-insensitive workspace root', () => {
  const resolve = (reference: string) => resolveWorkspacePath('/c:/repo/docs/readme.md', '/C:/Repo', reference, true)
  expect(resolve('../media/photo.png')?.path).toBe('/c:/repo/media/photo.png')
  expect(resolve('..%20/secret.png')).toBeUndefined()
  expect(resolve('NUL.png')).toBeUndefined()
  expect(resolve('directory./photo.png')).toBeUndefined()
})

it('decodes attachment-style references once across nested workspace paths', () => {
  const document = '/workspace/docs/nested/current.markdown'
  const root = '/workspace'
  const reference = '../../assets/caf%C3%A9%20%23%25%28final%29%252F.png'
  const expected = { path: '/workspace/assets/café #%(final)%2F.png', fragment: '' }
  expect(resolveWorkspacePath(document, root, reference)).toEqual(expected)
  expect(resolveWorkspacePath(document, root, reference, true)).toEqual(expected)
  expect(resolveWorkspacePath(document, root, '../' + reference)).toBeUndefined()
  expect(resolveWorkspacePath(document, '/workspace-other', reference)).toBeUndefined()
})
