# VS Code platform qualification

## Milestone 2.3 coverage

| Environment | Evidence |
| --- | --- |
| Native Windows | Windows 11 Pro 25H2 x64 (26200.9974), VS Code 1.147.0 x64 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`), local Node extension host and `file:` workspace. The Node filesystem probes ran on NTFS. |
| Synthetic provider | The Windows desktop suite adds `folio-test-remote://test-server/project` alongside a local workspace root. The provider and Folio run in the local extension host. |
| Native macOS and Linux | No native desktops were available. Run the desktop procedure below on each platform. |
| Real VS Code Remote | `wsl.exe --list --verbose` reported that WSL was absent, and no Docker/Podman runtime or SSH target was configured. There was no Remote window or server build to record. Run the Remote procedure on a disposable workspace when one is available. |

Use [the attachment qualification decision](extension-attachments.md#milestone-23-qualification-decision) for filesystem guarantees and [the benchmarks](extension-benchmarks.md) for performance. Report results per OS, VS Code build, transport, and backing filesystem.

## Milestone 2.4 continuation coverage

| Environment | Existing image references | Automatic attachment writes |
| --- | --- | --- |
| Windows 11 Pro x64, local NTFS | Desktop coverage exercises a local raster placed in the workspace and the normal Markdown save path. | Disabled. The strict Node and native probes reproduce disqualifying cases. |
| Synthetic non-file provider on Windows | Desktop coverage exercises preview, encoded paths, exact saves, and root and authority boundaries. | Disabled. Its injected faults demonstrate API limitations and ambiguous outcomes. |
| Other Windows filesystems, UNC and network shares | No separate qualification on these volumes. | Disabled. |
| Native macOS and Linux | Desktop and platform-specific read behavior remain unverified. | Disabled. |
| Generic and virtual providers, real VS Code Remote | Actual provider and transport behavior require qualification. | Disabled. |

Existing workspace image preview is subject to the resolver's read boundary and the provider's behavior. A successful preview, a writable `file:` workspace, and VS Code Workspace Trust do not qualify an attachment destination. See the [architecture decision](extension-attachments.md#milestone-24-architecture-decision).

All 32 desktop cases passed on VS Code 1.147.0. Three new local cases checked the actual image reference insertion flow in Visual, Source, and Split, including sandboxed dialog submission, preview bytes, native Save and Undo/Redo, and exact BOM/CRLF Markdown. The user-placed asset bytes and asset directory entries stayed intact. These cases exercise Markdown editing and resource reads.

## Milestone 2.5 picker coverage

| Workspace | Picker coverage |
| --- | --- |
| Local Windows drive-letter `file:` workspace on fixed NTFS | Supported. Verified on Windows 11 Pro 25H2 x64 (26200.9974) and VS Code 1.147.0, with the real extension host and VS Code's built-in Simple File Dialog. An image can be chosen from the originating folder in a multi-root window. |
| Other Windows volume types, UNC and mapped network drives, virtual and non-file providers | Browse is unavailable. The synthetic provider fixture verifies the browse gate and existing manual-reference preview. |
| macOS, Linux, and real VS Code Remote | Browse is unavailable. These hosts have no Milestone 2.5 picker qualification. |

All 43 Windows desktop tests passed, including 11 picker cases. They drive the real picker callback in Visual, Source, and both Split panes, then check exact BOM/CRLF Markdown and authored list markers, native Save and Undo/Redo, decoded previews, unchanged asset bytes and directory entries, cancellation, and two Folio views. Rejection cases include outside paths, a separate local workspace root, a junction into that root, SVG, invalid or truncated raster content, oversized raster content, operating-system read-only Markdown, a file changed or removed after selection, and stale native revisions even after Undo restores identical text. The workbench variant of the file dialog is automated. The OS-native dialog presentation has no separate automation coverage. [Implementation and read boundary](extension-attachments.md#milestone-25-reference-only-picker)

## Milestone 2.4 local filesystem probes

The native probe was run on Windows 11 Pro 25H2 x64 (26200.9974), NTFS, with Node 24.13.0 for the Node probes. Use the original checkout and keep the test directories disposable. The fixture deliberately tests behaviors that disqualify an attachment backend. A passing probe reproduces the recorded behavior.

```powershell
$env:FOLIO_LOCAL_FS_PROBE_DIR = (New-Item -Force -ItemType Directory -Path 'test-results/milestone-24-fs').FullName
$env:FOLIO_QUALIFY_LOCAL_FS = '1'
npm test -- src/host/vscode/attachmentPath.test.ts src/host/vscode/attachmentFilesystem.test.ts
Remove-Item Env:FOLIO_LOCAL_FS_PROBE_DIR, Env:FOLIO_QUALIFY_LOCAL_FS
powershell.exe -NoProfile -File tests/vscode/attachment-ntfs.ps1
```

The native PowerShell probe requires Windows x64 and an NTFS checkout. It writes only inside a disposable test fixture. It checks ordinary directory rename denial while handles are held, a junction opened without traversal, file identity, non-replacement of exact and case-equivalent names, and cleanup by the live stage handle. It also tests that the same native no-overwrite operation permits a canonically equivalent spelling. See the [Milestone 2.4 decision](extension-attachments.md#milestone-24-qualification-result) before adopting any of these primitives in a production backend.

The continuation passed all 44 lexical and strict filesystem cases and the native script. The Node cases reproduced redirected staging and publication after parent replacement, deletion of a replacement after an earlier identity check, and publication beside a normalization-equivalent late arrival. The native script checked a pre-existing NFD name against an NFC candidate and also admitted both. The run did not qualify a full ancestor chain, in-place reparse mutation protection, or ownership after handle loss.

## Disposable fixture

Save the following as `fixture.cjs` outside the repository. Run `node fixture.cjs folio-qualification` from a disposable parent directory. For Remote, run it from a terminal on the workspace machine.

```js
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const root = resolve(process.argv[2] || 'folio-qualification')
mkdirSync(root)
const put = (file, contents) => writeFileSync(join(root, file), contents)
for (const folder of ['root-a/docs', 'root-a/media', 'root-b/media', 'expected']) {
  mkdirSync(join(root, folder), { recursive: true })
}
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
const source = '\uFEFF' + [
  '# Qualification', '',
  '![Workspace pixel](../media/caf%C3%A9%20%23%25%28final%29%252F.png)', '',
  '[Relative](./target.markdown#L2) and [root relative](/target.md#L2)', '',
  '![Across the boundary](../../root-b/media/decoy.png)', '',
  'Text with  two spaces.', '',
].join('\r\n')
put('root-a/docs/folio.md', source)
put('root-a/docs/folio.markdown', source)
put('root-a/docs/target.markdown', '# Relative destination\nline two\n')
put('root-a/target.md', '# Root A destination\nline two\n')
put('root-b/target.md', '# Root B decoy\nline two\n')
put('root-a/media/café #%(final)%2F.png', pixel)
put('root-b/media/café #%(final)%2F.png', 'wrong root')
put('root-b/media/decoy.png', pixel)
put('expected/edited.txt', source.replace('# Qualification', '# Qualification edited'))
put('qualification.code-workspace', JSON.stringify({ folders: [{ path: 'root-a' }, { path: 'root-b' }] }))
```

For the heading edit, compare raw bytes from the OS or Remote terminal with this command from within the generated directory. Repeat for `.markdown`. Write a separate expected byte fixture for later scenarios before making additional edits.

```sh
node -e "const fs=require('node:fs'); if (!fs.readFileSync(process.argv[1]).equals(fs.readFileSync('expected/edited.txt'))) process.exitCode=1" root-a/docs/folio.md
```

## Native macOS and Linux desktops

1. Record the OS version, architecture, filesystem, `code --version`, keyboard layout, Node and npm versions. On Linux, use a desktop graphical session. Install dependencies with `npm ci`, then run `npm run package:extension` and `npm run test:extension`. Set `FOLIO_VSCODE_EXECUTABLE` to the desktop executable if automatic discovery fails. On macOS the default is VS Code's `Contents/MacOS/Electron`. Keep process restart tests confined to the harness profile.
2. Install `extension/dist/folio.vsix` in a disposable profile with **Extensions: Install from VSIX**. Open the fixture's workspace. Check both suffixes in the native editor, select **Reopen Editor With → Folio Markdown Editor**, and check **Developer: Show Running Extensions** for activation in the local workspace host.
3. Exercise each editing mode via the editor title's **Folio** submenu, Command Palette, and keyboard. Use Cmd+Option+Shift+V/M/S on macOS or Ctrl+Alt+Shift+V/M/S on Linux. Check focus in the Visual and Source panes. Check Properties and Go to Heading. Use light, dark, high-contrast dark, and high-contrast light themes. Inspect editor focus, selection, menus, and contrast.
4. Confirm the image displays in Visual and Split. Cmd+click or Ctrl+click both links and confirm the destination URI and line. Confirm the out-of-root image is unavailable. Add ` edited` to the heading. Save, Undo, and Redo using the native commands, observing the heading at each step. Save again, verify the exact bytes, and reopen in both editors.
5. Check a second Folio view and changes from the native editor. Run the `recovery.vscode.ts` cases for delayed edits, host restart, and recovery across rename or deletion. Check that unresolved drafts are offered for manual review, the buffer and disk stay authoritative, and a replacement file receives no automatic replay. Record test counts, failed case names, and the package version.

For local attachment primitives, set `FOLIO_LOCAL_FS_PROBE_DIR` to an existing writable disposable directory on the volume being qualified. Set `FOLIO_QUALIFY_LOCAL_FS=1` and run `npm test -- src/host/vscode/attachmentFilesystem.test.ts`. In PowerShell, set the variables through `$env:`, then clear both after the run. Record the filesystem and Node version. The strict flag makes a missing link primitive a qualification failure. In the ordinary unit run, a filesystem that explicitly refuses the required link operation can skip that probe with a reason.

## Real Remote over WSL, Dev Containers, or SSH

1. Use a disposable machine, WSL distro, or container with the official Remote extension. Connect from VS Code, build the fixture on the workspace side, and open `qualification.code-workspace` in that Remote window. Install the VSIX into the workspace host. Record transport, client version/commit, server version/commit from the Remote output log, client and server OS/architecture, filesystem, workspace and document URI schemes and authorities, and Folio's placement in **Developer: Show Running Extensions**. Redact private authority values in shared logs. A disposable diagnostic extension can log `vscode.env.remoteName`, `process.platform`, and the URI scheme of each workspace folder if the UI does not show them.
2. Check default and Folio opens for both suffixes. Follow both Markdown links, verify the image resolves to Root A and the boundary image is blocked, and inspect the same names in Root B. Edit from Folio and the native editor separately. Verify both views converge and Save produces the exact expected bytes on the Remote machine, including BOM and CRLF.
3. Open a second Folio view and a native view. Create disjoint edits while the first change is pending and verify both edits. Repeat with overlapping changes and capture the native and Folio snapshots in the recovery view. If the edits settled sequentially, repeat with a delayed transport in the disposable setup. Record the order and exact expected bytes for each result.
4. Briefly make a disposable fixture volume unavailable while keeping the Remote transport connected, if the environment provides a reversible way to do so. Record the failure VS Code actually presents, whether the host stays alive, whether pending Save succeeds on return, and both saved and recovered bytes. A permission failure or `FileNotFound` is a distinct result. Record this case as unverified if there is no way to produce temporary filesystem unavailability.
5. Separately interrupt the real connection during an edit awaiting acknowledgement. Confirm pending status before counting the attempt. Reconnect, note whether the original client and server survived, record which checkpoint was available and compare the complete draft and saved bytes. Then repeat with an actual Remote extension-host restart. Use the disposable connection's host controls and verify that Folio activated in a new host. Confirm the current native buffer and disk remain authoritative and that recovery never replays a draft automatically.
6. Rename the file while Folio is open, reopen the new URI, and check resources again. Delete it, then open a different Markdown file under the same root to find the old recovery record. Recreate the original path with different bytes and check that the old draft stays in review and the new file is untouched.

The automated desktop harness starts a local test profile and communicates through local fixture files. Use it for native desktops. The synthetic provider suite remains useful for controlled faults alongside the real Remote procedure.
