import { expect, it } from 'vitest'
import { attachmentFilename, attachmentReference, parseAttachmentDirectory } from './attachmentPath'
import { resolveWorkspacePath } from './resourcePath'

it('parses a portable, literal workspace-relative destination', () => {
  expect(parseAttachmentDirectory('media/café #%(final)')).toEqual(['media', 'café #%(final)'])
})

it.each([
  '', '/assets', '\\assets', 'C:assets', 'C:/assets', '.', '../assets', 'assets/../media',
  'assets/./media', 'assets//media', 'assets/', 'other%2fassets', 'other%5Cassets', 'assets\\media',
  'assets/NUL .png', 'assets/COM\u00b9', 'assets/CONIN$', 'assets/foo.', 'assets/foo ', 'assets/a\u0085', 'a\ud800',
  'assets/' + 'é'.repeat(128),
])('rejects an unsafe destination setting %j', directory => {
  expect(parseAttachmentDirectory(directory)).toBeUndefined()
})

it('normalizes uploaded names, removes forbidden characters, and uses the supplied raster extension', () => {
  expect(attachmentFilename('C:\\fakepath\\cafe\u0301<>\u0000 :#%(x). .JPEG', 'JPEG')).toBe('café #%(x).jpeg')
  expect(attachmentFilename('NUL .photo.png', 'png')).toBe('image.png')
  expect(attachmentFilename('..png', 'png')).toBe('image.png')
  expect(attachmentFilename('image.svg', 'svg')).toBeUndefined()
})

it('bounds the UTF-8 stem on a code point boundary and trims a dot exposed by truncation', () => {
  expect(attachmentFilename('🙂'.repeat(26) + '.png', 'png')).toBe('🙂'.repeat(25) + '.png')
  expect(attachmentFilename('a'.repeat(99) + '.é.png', 'png')).toBe('a'.repeat(99) + '.png')
})

it('picks a numbered suffix after normalization and case collisions in the supplied directory listing', () => {
  expect(attachmentFilename('café.PNG', 'png', ['CAFE\u0301.PNG', 'café-2.png'])).toBe('café-3.png')
  expect(attachmentFilename('Straße.png', 'png', ['STRAẞE.PNG', 'STRASSE-2.png'])).toBe('Straße-3.png')
  const occupied = ['image.png', ...Array.from({ length: 99 }, (_, i) => `image-${i + 2}.png`)]
  expect(attachmentFilename('image.png', 'png', occupied)).toBeUndefined()
})

const root = { scheme: 'file', authority: '', path: '/C:/Project' }
const document = { ...root, path: '/C:/Project/docs/readme.markdown' }
const asset = { ...root, path: '/C:/Project/media/café #%(final)%2F.png' }

it('round-trips a sibling asset once through the workspace resolver', () => {
  const reference = attachmentReference(document, root, asset, true)
  expect(reference).toBe('../media/caf%C3%A9%20%23%25%28final%29%252F.png')
  expect(resolveWorkspacePath(document.path, root.path, reference!, true)).toEqual({ path: asset.path, fragment: '' })
  expect(attachmentReference(document, root, { ...asset, path: '/c:/project/Docs/assets/one.png' }, true)).toBe('./assets/one.png')
})

it.each([
  { path: '/C:/Project-other/assets/image.png' }, { path: '/C:/Project' },
  { path: '/C:/Project/../other/image.png' }, { path: '/C:/Project/a\\b.png' },
  { path: '/C:/Project/media/NUL .png' }, { path: '/C:/Project/media/a\ud800.png' },
  { authority: 'other' }, { scheme: 'remote' }, { query: 'other' }, { fragment: 'heading' },
])('rejects an asset URI outside the lexical boundary or with invalid components %j', overrides => {
  expect(attachmentReference(document, root, { ...asset, ...overrides }, true)).toBeUndefined()
})

it('rejects a document from another workspace or authority', () => {
  expect(attachmentReference({ ...document, path: '/C:/Project-other/readme.md' }, root, asset, true)).toBeUndefined()
  expect(attachmentReference({ ...document, authority: 'other' }, root, asset, true)).toBeUndefined()
})
