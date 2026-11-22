// Decoded separators and controls must be rejected before constructing a provider URI.
// eslint-disable-next-line no-control-regex
const badSegment = /[\\/:\u0000-\u001f\u007f]/

export function resolveWorkspacePath(documentPath: string, rootPath: string, reference: string, ignoreCase = false) {
  if (reference.length > 4096 || reference.startsWith('//')) return
  const hash = reference.indexOf('#')
  const path = hash < 0 ? reference : reference.slice(0, hash)
  if (!path || path.includes('?')) return

  const root = rootPath.split('/').filter(Boolean)
  const directory = documentPath.split('/').filter(Boolean).slice(0, -1)
  const compare = (part: string) => ignoreCase ? part.toLowerCase() : part
  if (directory.length < root.length || root.some((part, index) => compare(part) !== compare(directory[index]))) return

  const parts = path.startsWith('/') ? [...root] : [...directory]
  try {
    for (const encoded of path.split('/').filter(Boolean)) {
      const part = decodeURIComponent(encoded)
      if (badSegment.test(part)) return
      if (part === '..') {
        if (parts.length === root.length) return
        parts.pop()
      } else if (part !== '.') {
        if (ignoreCase && (/[<>"|?*]|[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part))) return
        parts.push(part)
      }
    }
    if (parts.length === root.length) return
    const fragment = hash < 0 ? '' : decodeURIComponent(reference.slice(hash + 1))
    return { path: '/' + parts.join('/'), fragment }
  } catch { return }
}
