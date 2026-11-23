import { lstat, open, realpath, stat as fileStat } from 'node:fs/promises'
import { constants, type BigIntStats } from 'node:fs'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import * as vscode from 'vscode'
import { headingSlug } from '../../src/document/headingSlug'
import { resolveWorkspacePath } from '../../src/host/vscode/resourcePath'

const maximumImageBytes = 5 * 1024 * 1024
const imageFormats: Record<string, { mime: string; matches(bytes: Buffer): boolean }> = {
  png: { mime: 'png', matches: b => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  jpg: { mime: 'jpeg', matches: b => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  jpeg: { mime: 'jpeg', matches: b => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  gif: { mime: 'gif', matches: b => ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) },
  webp: { mime: 'webp', matches: b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  avif: { mime: 'avif', matches: b => ['ftypavif', 'ftypavis'].includes(b.toString('ascii', 4, 12)) },
  bmp: { mime: 'bmp', matches: b => b.toString('ascii', 0, 2) === 'BM' },
  ico: { mime: 'x-icon', matches: b => b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) },
}
export const workspaceImageExtensions = Object.keys(imageFormats)

async function resource(document: vscode.TextDocument, reference: string, strictLocal = false) {
  const { uri } = document
  if (vscode.workspace.fs.isWritableFileSystem(uri.scheme) === undefined || document.isUntitled) return
  const root = vscode.workspace.getWorkspaceFolder(uri)?.uri ?? vscode.Uri.joinPath(uri, '..')
  if (root.scheme !== uri.scheme || root.authority !== uri.authority) return
  const resolved = resolveWorkspacePath(uri.path, root.path, reference, uri.scheme === 'file' && process.platform === 'win32')
  if (!resolved) return
  const rootPath = root.path.replace(/\/$/, '')
  const children = resolved.path.slice(rootPath.length + 1).split('/')
  let current = root.with({ query: '', fragment: '' })
  if (strictLocal && (await lstat(current.fsPath)).isSymbolicLink()) return
  // Resolve provider-native paths and refuse symlinks anywhere beneath the trusted root.
  for (const [index, segment] of children.entries()) {
    current = vscode.Uri.joinPath(current, segment)
    const stat = await vscode.workspace.fs.stat(current)
    if (stat.type & vscode.FileType.SymbolicLink || (strictLocal && (await lstat(current.fsPath)).isSymbolicLink())) return
    if (index === children.length - 1 && stat.type === vscode.FileType.File) return { uri: current, root, stat, fragment: resolved.fragment }
    if (stat.type !== vscode.FileType.Directory) return
  }
}

type ResolvedResource = NonNullable<Awaited<ReturnType<typeof resource>>>

export async function canonicalPickerRoot(root: vscode.Uri) {
  const path = root.fsPath
  const canonical = await realpath(path)
  if (relative(path, canonical)) return
  // Windows path comparison folds case even in directories that distinguish it.
  // Refuse linked ancestors before using the canonical root as a containment boundary.
  let folder = path
  for (;;) {
    if ((await lstat(folder)).isSymbolicLink()) return
    const parent = dirname(folder)
    if (parent === folder) return canonical
    folder = parent
  }
}

async function canonicalFile({ root, uri }: ResolvedResource, strict = false) {
  const [directory, file] = await Promise.all([strict ? canonicalPickerRoot(root) : realpath(root.fsPath), realpath(uri.fsPath)])
  if (!directory) return
  if (strict) return file.startsWith(directory.replace(/[\\/]$/, '') + sep) ? file : undefined
  const child = relative(directory, file)
  return child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child) ? file : undefined
}

function sameFile(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}

async function readLocalImage(target: ResolvedResource, expectedPath?: string) {
  const strict = expectedPath !== undefined
  const path = await canonicalFile(target, strict)
  if (!path || (strict && path !== expectedPath)) return
  // Pin the local file before checking its identity. A provider path alone can race a symlink replacement.
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const file = await open(path, flags)
  try {
    const opened = await file.stat({ bigint: true })
    if (!opened.isFile() || opened.size > BigInt(maximumImageBytes) || await canonicalFile(target, strict) !== path) return
    const named = await fileStat(path, { bigint: true })
    if (opened.dev !== named.dev || opened.ino !== named.ino) return
    const bytes = Buffer.alloc(Number(opened.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== Number(opened.size)) return
    if (strict && (!sameFile(opened, await file.stat({ bigint: true })) ||
      !sameFile(opened, await lstat(path, { bigint: true })) || await canonicalFile(target, true) !== path)) return
    return { bytes: bytes.subarray(0, offset), path, stat: opened }
  } finally { await file.close() }
}

function imageFormat(path: string) {
  const extension = /\.([a-z\d]+)$/i.exec(path)?.[1].toLowerCase()
  return extension && Object.hasOwn(imageFormats, extension) ? imageFormats[extension] : undefined
}

export async function verifyPickedImage(document: vscode.TextDocument, root: vscode.Uri, picked: vscode.Uri, reference: string) {
  const format = imageFormat(picked.path)
  if (!format) throw new Error('Select a PNG, JPEG, GIF, WebP, AVIF, BMP, or ICO image.')
  const target = await resource(document, reference, true)
  if (!target || target.root.toString() !== root.toString()) {
    throw new Error('Select a regular image inside this workspace folder. Linked paths are unsupported.')
  }
  if (target.stat.size > maximumImageBytes) throw new Error('Select an image that is 5 MiB or smaller.')
  // Compare the actual chosen path too. Windows can have case-sensitive directories.
  const opened = await readLocalImage(target, await realpath(picked.fsPath))
  if (!opened) {
    throw new Error('The selected image is outside the workspace or changed during validation.')
  }
  if (!format.matches(opened.bytes)) throw new Error('The selected file does not match its raster image format.')
  return { ...opened, mime: format.mime }
}

export async function workspaceImage(document: vscode.TextDocument, reference: string) {
  const format = imageFormat(decodeURIComponent(reference))
  if (!format) return
  const target = await resource(document, reference)
  if (!target || target.stat.size > maximumImageBytes) return
  const local = target.uri.scheme === 'file'
  const bytes = local ? (await readLocalImage(target))?.bytes : Buffer.from(await vscode.workspace.fs.readFile(target.uri))
  if (!bytes || bytes.length > maximumImageBytes || (!local && !await resource(document, reference)) || !format.matches(bytes)) return
  return `data:image/${format.mime};base64,${bytes.toString('base64')}`
}

async function selection(uri: vscode.Uri, fragment: string) {
  const line = /^L([1-9]\d*)$/.exec(fragment)
  if (line) {
    const index = Number(line[1]) - 1
    if (Number.isSafeInteger(index)) return new vscode.Range(index, 0, index, 0)
  }
  const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', uri)
  const anchors = new Set<string>()
  function find(items: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]): vscode.Range | undefined {
    for (const symbol of items) {
      const slug = headingSlug(symbol.name.replace(/^#+\s+/, ''))
      let anchor = slug
      for (let index = 1; anchors.has(anchor); index++) anchor = `${slug}-${index}`
      anchors.add(anchor)
      if (anchor === fragment) {
        const { start } = 'selectionRange' in symbol ? symbol.selectionRange : symbol.location.range
        return new vscode.Range(start, start)
      }
      const child = 'children' in symbol ? find(symbol.children) : undefined
      if (child) return child
    }
  }
  return find(symbols ?? [])
}

export async function openWorkspaceMarkdown(document: vscode.TextDocument, reference: string, column: vscode.ViewColumn | undefined, valid: () => boolean) {
  if (!/\.(?:md|markdown)(?:#|$)/i.test(decodeURIComponent(reference))) return false
  const target = await resource(document, reference)
  if (!target || !/\.(?:md|markdown)$/i.test(target.uri.path) || !valid()) return false
  const local = target.uri.scheme === 'file'
  const path = local ? await canonicalFile(target) : undefined
  if (local && !path) return false
  const uri = path ? vscode.Uri.file(path) : target.uri
  const range = target.fragment ? await selection(uri, target.fragment).catch(() => undefined) : undefined
  if (!await resource(document, reference) || (local && await canonicalFile(target) !== path)) return false
  if (!valid()) return false
  await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: column, selection: range, preview: true })
  return true
}
