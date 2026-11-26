import { open } from 'node:fs/promises'
import * as vscode from 'vscode'

export function isLocalDocumentFile(uri: vscode.Uri) {
  return !vscode.env.remoteName && uri.scheme === 'file' && !uri.authority &&
    (process.platform !== 'win32' || /^\/[a-z]:\//i.test(uri.path))
}

export async function readLocalDocument(uri: vscode.Uri, limit: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!isLocalDocumentFile(uri)) throw new Error('This Folio editor requires a local file.')
  signal?.throwIfAborted()
  const file = await open(uri.fsPath, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > limit) throw new Error(`Open a regular file no larger than ${limit / (1024 * 1024)} MiB.`)
    const bytes = new Uint8Array(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const after = await file.stat()
    if (offset !== before.size || before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
      throw new Error('The file changed while Folio was reading it. Try again.')
    }
    signal?.throwIfAborted()
    return bytes.subarray(0, offset)
  } finally { await file.close() }
}
