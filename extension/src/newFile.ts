import { createHash } from 'node:crypto'
import { open, readFile, unlink } from 'node:fs/promises'

export const newFileExists = 'A file with this name already exists. Folio saves PDF copies only as new files and does not replace existing files. Choose a different name.'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/**
 * Creates `path` exclusively (O_CREAT | O_EXCL), so an existing file is never replaced, writes and flushes the bytes,
 * and reads them back. An incomplete file created by this call is removed.
 */
export async function writeNewFile(path: string, bytes: Uint8Array, label = 'PDF copy') {
  let handle
  try { handle = await open(path, 'wx') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(label === 'PDF copy' ? newFileExists : 'A file with this name already exists. Choose a new filename for the Folio copy.', { cause: error })
    }
    throw new Error(`VS Code could not create the ${label} at this location.`, { cause: error })
  }
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(path).catch(() => undefined)
    throw new Error(`VS Code could not finish writing the ${label}. No file was kept.`, { cause: error })
  }
  await handle.close()
  if (digest(await readFile(path)) !== digest(bytes)) throw new Error(`The saved ${label} did not match the reviewed file. Check the destination and export again.`)
}
