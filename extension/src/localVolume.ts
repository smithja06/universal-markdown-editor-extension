import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as vscode from 'vscode'

const run = promisify(execFile)
const volumes = new Map<string, Promise<boolean>>()

/** Drive letter for a local Windows `file:` URI in a local extension host, otherwise undefined. */
export function localWindowsDrive(uri: vscode.Uri) {
  const drive = /^\/([a-z]:)\//i.exec(uri.path)?.[1]
  if (process.platform !== 'win32' || vscode.env.remoteName || uri.scheme !== 'file' || uri.authority || !drive) return
  return drive.toUpperCase()
}

/** Whether the drive is a fixed (DriveType 3) NTFS volume. Node statfs does not expose the Windows filesystem type. */
export function isFixedNtfs(drive: string) {
  let result = volumes.get(drive)
  if (!result) {
    const systemRoot = process.env.SystemRoot
    result = !systemRoot ? Promise.resolve(false) : run(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance -Query "SELECT DeviceID FROM Win32_LogicalDisk WHERE DeviceID='${drive}' AND DriveType=3 AND FileSystem='NTFS'" -ErrorAction Stop).DeviceID`,
    ], { windowsHide: true, timeout: 5000 }).then(({ stdout }) => stdout.trim().toUpperCase() === drive, () => false)
    volumes.set(drive, result)
    // A failed or negative probe is retried later because volumes can be mounted or reformatted.
    void result.then(ok => { if (!ok) volumes.delete(drive) })
  }
  return result
}

export async function onQualifiedVolume(uri: vscode.Uri) {
  const drive = localWindowsDrive(uri)
  return !!drive && await isFixedNtfs(drive)
}
