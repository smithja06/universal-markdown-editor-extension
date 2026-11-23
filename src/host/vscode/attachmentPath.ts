import { resolveWorkspacePath } from './resourcePath'

const forbidden = /[<>:"|?*\\\p{Cc}\p{Cs}]/u
const trailing = /[. ]+$/u
const device = /^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[0-9¹²³])$/iu
const rasterExtension = /^(?:png|jpe?g|gif|webp|avif|bmp|ico)$/i
const utf8 = new TextEncoder()

function isDevice(name: string) {
  return device.test(name.split('.')[0].trimEnd())
}

function portableSegment(name: string) {
  return name.length > 0 && !forbidden.test(name) && !trailing.test(name) && !isDevice(name) && utf8.encode(name).length <= 255
}

/** Parse a literal setting. Filesystem containment is a separate backend requirement. */
export function parseAttachmentDirectory(directory: string) {
  const segments = directory.split('/')
  if (segments.every(segment => portableSegment(segment) && !/%(?:2f|5c)/i.test(segment))) return segments
}

function collisionKey(name: string) {
  return name.normalize('NFC').toLowerCase().toUpperCase().normalize('NFC')
}

/** Choose a candidate from a listing. The listing reserves no names on disk. */
export function attachmentFilename(displayName: string, checkedExtension: string, entries: readonly string[] = []) {
  if (!rasterExtension.test(checkedExtension)) return
  const extension = checkedExtension.toLowerCase()
  const basename = displayName.split(/[\\/]/).at(-1) ?? ''
  const dot = basename.lastIndexOf('.')
  const cleaned = (dot < 0 ? basename : basename.slice(0, dot))
    .replace(/[<>:"|?*\\\p{Cc}\p{Cs}]/gu, '').normalize('NFC')
  let stem = ''
  let size = 0
  for (const point of cleaned) {
    size += utf8.encode(point).length
    if (size > 100) break
    stem += point
  }
  stem = stem.replace(trailing, '')
  if (!stem || isDevice(stem)) stem = 'image'

  const occupied = new Set(entries.map(collisionKey))
  for (let number = 1; number <= 100; number++) {
    const name = number === 1 ? `${stem}.${extension}` : `${stem}-${number}.${extension}`
    if (!occupied.has(collisionKey(name))) return name
  }
}

interface ResourceUri {
  scheme: string
  authority: string
  path: string
  query?: string
  fragment?: string
}

function uriSegments({ path, scheme, query, fragment }: ResourceUri, allowTrailingSlash = false) {
  if (!path.startsWith('/') || query || fragment) return
  if (path === '/') return []
  const segments = (allowTrailingSlash ? path.replace(/\/$/, '') : path).slice(1).split('/')
  if (segments.every((segment, index) =>
    portableSegment(segment) || (index === 0 && scheme === 'file' && /^[a-z]:$/i.test(segment)))) return segments
}

/** Build a relative Markdown reference for URIs already authorized by the host. */
export function attachmentReference(document: ResourceUri, root: ResourceUri, asset: ResourceUri, ignoreCase = false) {
  if ([document, asset].some(uri => uri.scheme !== root.scheme || uri.authority !== root.authority)) return
  const rootParts = uriSegments(root, true)
  const documentParts = uriSegments(document)
  const assetParts = uriSegments(asset)
  if (!rootParts || !documentParts || !assetParts ||
    documentParts.length <= rootParts.length || assetParts.length <= rootParts.length) return

  const compare = (part: string) => ignoreCase ? part.toLowerCase() : part
  if (rootParts.some((part, index) =>
    compare(part) !== compare(documentParts[index]) || compare(part) !== compare(assetParts[index]))) return

  const directoryLength = documentParts.length - 1
  let common = rootParts.length
  while (common < Math.min(directoryLength, assetParts.length - 1) &&
    compare(documentParts[common]) === compare(assetParts[common])) common++
  const prefix = common === directoryLength ? './' : '../'.repeat(directoryLength - common)
  const reference = prefix + assetParts.slice(common).map(part =>
    encodeURIComponent(part).replace(/[()]/g, char => char === '(' ? '%28' : '%29')).join('/')
  const resolved = resolveWorkspacePath(document.path, root.path, reference, ignoreCase)
  if (resolved && compare(resolved.path) === compare(asset.path)) return reference
}
