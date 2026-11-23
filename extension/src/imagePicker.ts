import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import { attachmentReference } from '../../src/host/vscode/attachmentPath'
import { canonicalPickerRoot, verifyPickedImage, workspaceImageExtensions } from './resources'

const run = promisify(execFile)
const unsupported = 'Browsing requires a local Windows workspace on a fixed NTFS drive. You can enter a relative image reference manually.'

async function pickerRoot(document: vscode.TextDocument) {
  const { uri } = document
  const drive = /^\/([a-z]:)\//i.exec(uri.path)?.[1]
  if (process.platform !== 'win32' || vscode.env.remoteName || uri.scheme !== 'file' || uri.authority || !drive) {
    throw new Error(unsupported)
  }
  const root = vscode.workspace.getWorkspaceFolder(uri)?.uri
  if (!root) throw new Error('Open the Markdown document in a workspace folder to browse its images.')
  const systemRoot = process.env.SystemRoot
  if (!systemRoot) throw new Error(unsupported)
  // Node statfs does not expose the Windows filesystem type. Query just the initiating volume.
  const shell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const query = `SELECT DeviceID FROM Win32_LogicalDisk WHERE DeviceID='${drive}' AND DriveType=3 AND FileSystem='NTFS'`
  const result = await run(shell, ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-CimInstance -Query "${query}" -ErrorAction Stop).DeviceID`], { windowsHide: true, timeout: 5000 }).catch(() => undefined)
  if (result?.stdout.trim().toLowerCase() !== drive.toLowerCase() || !await canonicalPickerRoot(root).catch(() => undefined)) {
    throw new Error(unsupported)
  }
  return root
}

function imageFingerprint({ path, bytes, stat }: Awaited<ReturnType<typeof verifyPickedImage>>) {
  return [path, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, createHash('sha256').update(bytes).digest('hex')].join('\n')
}

async function inspect(document: vscode.TextDocument, root: vscode.Uri, uri: vscode.Uri, reference: string) {
  try {
    return await verifyPickedImage(document, root, uri, reference)
  } catch (error) {
    if (error instanceof vscode.FileSystemError || (error instanceof Error && 'code' in error)) {
      throw new Error('The selected image is missing or unavailable. Browse again.', { cause: error })
    }
    throw error
  }
}

async function checkWritable(document: vscode.TextDocument) {
  const [native, provider] = await Promise.all([stat(document.uri.fsPath), vscode.workspace.fs.stat(document.uri)])
  if (!(native.mode & 0o222) || provider.permissions === vscode.FilePermission.Readonly) {
    throw new Error('This Markdown document is read-only. Make it writable before inserting a workspace image.')
  }
}

export async function pickWorkspaceImage(document: vscode.TextDocument, check: () => void) {
  const root = await pickerRoot(document)
  await checkWritable(document)
  check()
  const [uri] = await vscode.window.showOpenDialog({
    title: 'Browse workspace images',
    defaultUri: root,
    openLabel: 'Select image',
    canSelectFiles: true,
    canSelectMany: false,
    filters: { 'Raster images': workspaceImageExtensions },
  }) ?? []
  if (!uri) return
  check()
  const reference = attachmentReference(document.uri, root, uri, true)
  if (!reference || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.toString()) {
    throw new Error('Select an image inside the same workspace folder as this Markdown document.')
  }
  const opened = await inspect(document, root, uri, reference)
  return {
    image: { uri, root, reference, fingerprint: imageFingerprint(opened) },
    preview: `data:image/${opened.mime};base64,${opened.bytes.toString('base64')}`,
  }
}

export type WorkspaceImageSelection = NonNullable<Awaited<ReturnType<typeof pickWorkspaceImage>>>['image']

export async function confirmWorkspaceImage(document: vscode.TextDocument, { uri, root, reference, fingerprint }: WorkspaceImageSelection) {
  if ([document.uri, uri].some(item => vscode.workspace.getWorkspaceFolder(item)?.uri.toString() !== root.toString())) {
    throw new Error('The workspace folder changed. Browse again.')
  }
  await checkWritable(document)
  if (fingerprint !== imageFingerprint(await inspect(document, root, uri, reference))) {
    throw new Error('The selected image changed after browsing. Browse again.')
  }
  return reference
}
