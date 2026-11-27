# VS Code platform qualification

## Phase 10.1 qualification

Same host as Phase 10 (Windows 11 Pro x64, fixed NTFS `C:`, local `file:` workspace). [Phase 10.1 record](phase-10.1-release-qualification.md).

| Host | Build | Result |
| --- | --- | --- |
| VS Code 1.147.0 portable (`8a14f0cc1b`) | Development bundle, full desktop suite, `63894ca` | **89 passed of 89** in one uninterrupted run |
| VS Code 1.100.0 portable (`19e0f9e6`) | Installed VSIX `6c4cde7f…`, and again with the icon build `54677dac…` | 34 passed of 34 each time |
| VS Code 1.147.0 portable | Installed VSIX, both builds | 34 passed of 34 each time |
| VS Code 1.148.0 installed (`661626d0e7`) | Installed VSIX, both builds | 34 passed of 34 each time |

`72a5c32` (VSIX `730c0db1…`) was 88 of 88 on the development bundle and 33 of 33 installed on each host.

`c311e8a` (VSIX `4e374c34…`) was 87 of 87 on the development bundle, after one theme expectation was updated, and 32 of 32 installed on each host.

Round 1 (`c7329eb`, VSIX `e44a231b…`) was 83 of 83 on the development bundle and 28 of 28 installed on each host.

The PDF clipboard case passes on every host. The installed runs add `XLSX Save and Save As keep sheets, styles, merges, rules, theme and formulas`. Round 2 adds single Replace through the find form, Enter in the PDF page box, Ctrl+B/I/U in the grid, cell editor and formula bar without toggling the side bar, calculation on a typed formula, and the calculation banner after a cross-sheet row insert. `72a5c32` adds DOCX native Save of font, size, color, highlight, strikethrough, alignment and indentation. `63894ca` adds caret placement for clicks beside lines and Backspace removing an indent (`DOCX clicks beside`, added to the runbook filter).

**Harness change.** `tests/vscode/desktop.ts` no longer writes `extensions.autoUpdate` to the isolated profile. VS Code 1.147 migrates `false` to `"off"` by rewriting `settings.json` about two seconds after startup. A window reload during that write waited forever on VS Code's backup veto (`onBeforeShutdown … pending operations: veto.backups`). The recovery-after-reload case failed 3 of 13 repeats before the change and 0 of 12 after it. `extensions.autoCheckUpdates: false` still prevents updates.

**Screenshots** are captured with `FOLIO_SCREENSHOTS=1` (`tests/vscode/release.screens.ts`).

## Phase 10 qualification

Windows 11 Pro 25H2 x64 (10.0.26200.9974), fixed NTFS `C:`, local `file:` workspaces, Node 24.13.0, npm 11.21.0, Playwright 1.65.1.

| Host | Build | Result |
| --- | --- | --- |
| VS Code 1.147.0 portable zip (`8a14f0cc1b`) | Development bundle, full desktop suite | 81 passed, 1 failed of 82 in one uninterrupted run |
| VS Code 1.100.0 portable zip (`19e0f9e6`, Electron 34.5.1, Chromium 132), the manifest minimum | Installed final VSIX | 26 passed, 1 failed of 27 |
| VS Code 1.147.0 portable zip | Installed final VSIX | 26 passed, 1 failed of 27 |
| VS Code 1.148.0 installed (`661626d0e7`) | Installed final VSIX | 26 passed, 1 failed of 27 |

The failure is the same in every row. `PDF opens only through the opt-in viewer…` fails at its clipboard read-back because the Windows session refused clipboard access to every process. PowerShell `Set-Clipboard` failed too, and the session was idle for six days. Rerun it on an unlocked session. Installed runs set `FOLIO_TEST_VSIX=extension/dist/folio.vsix`, `FOLIO_VSCODE_EXECUTABLE` and `FOLIO_VSCODE_CLI_JS`. Before the pdf.js legacy switch, all PDF viewing and export failed on 1.100.0.

```powershell
$env:FOLIO_TEST_VSIX = 'extension/dist/folio.vsix'
npx playwright test --config playwright.vscode.config.ts binarySave.vscode.ts spreadsheet.vscode.ts pdf.vscode.ts pdfExport.vscode.ts editor.vscode.ts multiformat.vscode.ts -g "native binary Save|XLSX|CSV|PDF|Markdown exports|TXT and DOCX export|opens optionally|TXT defaults to native|TXT Replace changes|DOCX clicks beside|DOCX offers reviewed|DOCX flags|Restricted Mode|native DOCX backups|Save As" --output test-results/p10-installed
```

**Environment workaround.** A pending background update of the installed VS Code held the `vscode-updating` installer mutex. Every new instance logged `checkInnoSetupMutex: vscode-updating is held` and exited, so the harness could not start. Portable zip builds skip that mutex: `https://update.code.visualstudio.com/1.147.0/win32-x64-archive/stable` (zip SHA-256 `42d65f18009959964d7cff8ca6f33149a195d52c08622821c8c681a08469c26e`) and `https://update.code.visualstudio.com/1.100.0/win32-x64-archive/stable` (zip SHA-256 `6fa62a8f07a2b42993b19f81ed90c95a2de78299b7e227f226c76d87ceb06a9c`). Both carried valid Microsoft signatures. Point the harness at them with `FOLIO_VSCODE_EXECUTABLE`.

**Native Save qualification boundary.** Qualified only on the environment above. The tests cover:

- a competing process holding the file
- external write, delete and rename-over attempts during the save
- an external replacement before the save
- verification rollback
- stopped-write classification and recovery from a real journal
- Save As refusing existing files
- Undo past the save point
- exact CSV bytes
- three VS Code versions

Not covered: disk-full and power loss during the write, other Windows volume types, macOS, Linux and Remote. The gate disables native Save there.

**Readers.**

- Word 365 16.0.20625 read the Folio DOCX with exact 180 pt and 72 pt fixed columns.
- pypdf 7.1.1 strict and Windows.Data.Pdf read the Folio PDF.
- Python `csv` parsed the native-saved CSV.
- Excel 365 automation could not read any opened workbook in the locked session, including Excel's own, so it is not qualified in Phase 10.
- LibreOffice is not installed.

[Phase 10 record](phase-10-final-integration.md#11-test-commands-and-results)

## Phase 9 spreadsheet qualification

Qualification used Windows 11 x64, desktop VS Code 1.147.0, Node 24.13.0 and Chromium 159.0.8154.6. Workspace fixtures were local drive-letter file URIs, plus an isolated virtual-workspace provider and an independently isolated Restricted Mode profile. Minimum-version desktop, other platforms, true Remote, additional providers and OS-native copy dialogs remain open.

| Workflow | Verified boundary |
| --- | --- |
| Optional CSV editor | VS Code Text Editor remained the default, including in Restricted Mode. Folio preserved literal formula-like cells and padded identifiers and supported native dirty state, Undo/Redo, and Revert. |
| XLSX | Optional registration, multiple sheets and imported cached results. Explicit local calculation worked from the installed WASM worker. Tab hiding preserved the session. Revert to replacement bytes reset calculation trust, with the replacement’s cached value visible. |
| Recovery | The CSV fixture verified hot exit and a simultaneous external replacement followed by explicit Revert. Native checkpoints precede acknowledgment. The secondary webview journal is limited to 2 MiB, so a larger queued change can be interrupted before acknowledgment by an abrupt crash. |
| Copy delivery | CSV safe-copy, XLSX fresh-cache and selected-range PNG exports passed through the VS Code simple file dialog. Output XLSX reimported with its formula and new cache. The installed PNG test read back the signature and exact 208 × 52 range dimensions. Source bytes and dirty-state boundaries were checked. |
| Boundaries | The virtual provider was declined. Restricted Mode retained the native text editor and kept Folio unavailable. |

Eight installed spreadsheet cases passed on the final local 204-entry VSIX. Its SHA-256 is 9ca957adaf31873b62b01f532524ef0e8c8cf5c3c22c0734168e1e49aabd9241. The inventory matched all packaged runtime files with their built counterparts, and the packaged XLSX WASM and notice matched their npm and repository inputs.

[Phase 9 architecture, browser qualification and independent reader checks](phase-9-spreadsheets.md)

## Phase 8 PDF qualification

The November 26, 2026 qualification used Windows 11 Pro 25H2 x64 (26200.9974), desktop VS Code 1.147.0 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`), Node 24.13.0 and npm 11.21.0, on local drive-letter `file:` workspaces on fixed NTFS. The synthetic `folio-test-remote:` provider exercised rejection, and a Workspace Trust profile exercised Restricted Mode. The minimum supported VS Code version, Remote, other providers and volumes, macOS, Linux and browser-only VS Code are unqualified for the PDF viewer and PDF copies.

| Workflow | Qualification boundary |
| --- | --- |
| PDF viewer | Opt-in **Folio PDF Viewer** only. Rendering of searchable, image-only and active-content fixtures, previous/next and direct page navigation, zoom steps, fit page and fit width, find with match navigation, **Copy page text** and native Ctrl+C through `vscode.env.clipboard`. No dirty state and unchanged workspace bytes. External replacement shows a banner, and **Reload from disk** shows the new page count. Deletion keeps the opened version and reports it. Closing disposes the webview. Malformed files show an explanation, embedded links, scripts and form fields have no effect, non-file providers are rejected, and Restricted Mode leaves the viewer unavailable. |
| PDF copies | **Export PDF…** from Markdown, TXT and DOCX. **Save PDF copy…** through VS Code's simple file dialog to a new file, followed by a pdf.js text readback. Dialog cancellation leaves no file and keeps the review open. A native edit after the preview blocks delivery until **Review current revision**. The source Markdown bytes, DOCX package and clean state are unchanged. |
| Unqualified | The OS-native save dialog, its replace confirmation (the exclusive-create refusal is covered by `src/host/vscode/newFile.test.ts`), disk-full and permission failures during the copy write, PDFs above the measured fixtures in VS Code, and screen-reader use of the text layer. |

| Command | Result |
| --- | --- |
| `npm run test:extension -- --output test-results/p8-desktop-full` | 68 passed in 7.6 min, all 60 existing and eight PDF desktop cases. |
| Installed VSIX, below | 12 passed on VS Code 1.147.0 with the packaged `extension/dist/folio.vsix` (SHA-256 `93c1fe766837f4a1016e290fb6c8bc338c60bc2eb87106ff0a8ff5ab1eb58d92`). |

```powershell
$env:FOLIO_TEST_VSIX = 'extension/dist/folio.vsix'
$env:FOLIO_VSCODE_CLI_JS = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/8a14f0cc1b/resources/app/out/cli.js'
npx playwright test --config playwright.vscode.config.ts pdf.vscode.ts pdfExport.vscode.ts editor.vscode.ts multiformat.vscode.ts -g 'PDF|Markdown exports|TXT and DOCX export|stale PDF|opens optionally|TXT defaults to native|DOCX offers reviewed|Restricted Mode' --output test-results/p8-installed
Remove-Item Env:FOLIO_TEST_VSIX, Env:FOLIO_VSCODE_CLI_JS
```

[Phase 8 architecture and limits](phase-8-pdf.md) · [Handoff verification](PROJECT_HANDOFF.md#phase-8-verification)

## Phase 7C multi-format qualification

The November 26, 2026 qualification used Windows 11 Pro 25H2 x64 (26200.9974), desktop VS Code 1.147.0 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`), Node 24.13.0, and npm 11.21.0. Test workspaces used local, drive-letter `file:` URIs on fixed `C:` NTFS. Standalone browser coverage used Chromium 159.0.8154.6. The synthetic `folio-test-remote:` fixture exercised provider rejection, and a profile with independent user, extension, and shared-data directories exercised Restricted Mode. Minimum-version retesting, true Remote, other providers and volumes, macOS and Linux desktop, and browser-only VS Code remain unqualified for the new formats.

| Workflow | Qualification boundary |
| --- | --- |
| TXT | Native default and opt-in Folio, literal edits, find/replace, native Save and history, BOM/CRLF exact bytes, LF, native-buffer changes, Revert, mixed-ending read-only UI, conflict review, webview disposal, and an extension-host stop before host acceptance. Unsupported encodings and mixed/CR-only endings are outside writable scope. |
| DOCX | Opt-in local package open and malformed/unsupported rejection, formatting and table edits, find/replace, native dirty state and history, Revert, exact original, reviewed copy export, stale revision rejection, external replacement, native Save and Save As boundaries, pending webview recovery, accepted host-journal recovery, and native hot-exit restoration after actual reload. |
| DOCX write gate | Native Save and Save As reject without attempting destination writes. Cancellation before destination selection, an external replacement while dirty, and preservation of the dirty draft are separate observations. There was no in-place write to interrupt or writable-provider failure to simulate. The reviewed copy uses the workbench renderer's download facility, and output is reimported in the test. |
| Remaining lifecycle coverage | Disk or profile-storage failure during backup, a native backup lagging a later acknowledged revision in a live host, and sustained near-limit DOCX editing are unqualified. Original bytes survive native backup restore. A journal-only draft with a different package fingerprint remains for manual review. |

See `tests/vscode/multiformat.vscode.ts` for the desktop fixtures. Set `FOLIO_TEST_VSIX=extension/dist/folio.vsix` and `FOLIO_VSCODE_CLI_JS` to the selected VS Code install's `resources/app/out/cli.js` to run installed smoke cases using the VS Code CLI. Omit `FOLIO_TEST_VSIX` for desktop tests that instrument the development bundle. Use distinct Playwright output paths and keep the isolated fixture root outside those paths.

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` and `npx tsc --project extension/tsconfig.json` | Passed. The final production extension build ran both checks again. |
| `npm test` | 221 passed in 20 files, including DOCX workspace snapshot validation and competing rich revision review. |
| `npm run build` and `npm run build:extension` | Passed with the existing Vite chunk-size warnings. |
| `npm run test:e2e -- --workers=5 --output test-results/phase-7c-chromium-final` | 74 passed with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` set to the Playwright Chromium binary. Markdown, TXT, and DOCX standalone cases all passed. |
| `npm run test:extension -- --output test-results/phase-7c-desktop` | 60 passed, including 16 multi-format and all 44 baseline desktop cases. A final focused development and installed rerun exercised the persistent failed-Revert explanation and the original-package download after hot exit. |
| `npm run package:extension` | Produced `extension/dist/folio.vsix`, with 187 ZIP entries, 3,510,915 bytes, and SHA-256 `cd0764731b0302165513443c9768a11a8bfcc5e8a23a2f65ede888e217c5790d`. Python ZIP inspection matched the complete inventory, manifest, worker, notices, and webview assets to the built files. The 151,480-byte DOCX worker is the sole compiled ZIP/XML codec bundle in the VSIX. |
| VSIX install and smoke below | Eight passed on VS Code 1.147.0. Separate isolated installs exercised optional Markdown and TXT, native TXT byte fidelity and Revert, DOCX formatting and reviewed downloads, failed and clean DOCX Revert, DOCX hot exit with exact original bytes, and Restricted Mode. |

```powershell
$env:FOLIO_TEST_VSIX = 'extension/dist/folio.vsix'
$env:FOLIO_VSCODE_CLI_JS = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/8a14f0cc1b/resources/app/out/cli.js'
npx playwright test --config playwright.vscode.config.ts editor.vscode.ts multiformat.vscode.ts -g 'opens optionally|TXT defaults to native|TXT discloses|TXT replaces literal|DOCX offers reviewed|DOCX flags a replacement|Restricted Mode|native DOCX backups' --output test-results/phase-7c-installed-final
Remove-Item Env:FOLIO_TEST_VSIX, Env:FOLIO_VSCODE_CLI_JS
```

Development checks first reproduced the missing opt-in editors. Subsequent fixture corrections isolated the shared-data directory for Restricted Mode and recreated the custom editor after the extension-host process stopped. The Save As fixture checks the destination and the native dirty state because the workbench catches provider save errors. The initial installed smoke could not reliably observe a transient DOCX Revert failure notification. Folio now retains the failure explanation in the editor, reestablishes a native draft edit when needed, and preserves the profile backup on failure. The final installed smoke passed.

## Milestone 2.7 environment matrix

| Environment | Actual coverage |
| --- | --- |
| Windows 11 Pro 25H2 x64, build 26200.9974 | VS Code 1.147.0 x64 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`, Electron 43.8.9, Chromium 150.0.7871.250, Node 24.22.1) ran all 44 desktop cases in a local workspace host. The fixtures used a drive-letter `file:` URI with empty authority on fixed `C:` NTFS. The directory case-sensitive attribute was disabled. The real VS Code chooser used Simple File Dialog presentation. |
| Windows minimum-version smoke | VS Code 1.100.0 x64 (`19e0f9e681ecb8e5c09d8784acaa601316ca4571`, Electron 34.5.1, Chromium 132.0.6834.210, Node 20.19.0) installed the actual VSIX in separate local profiles for ordinary use and Restricted Mode. |
| Windows synthetic provider | Local Windows extension-host fixture on `folio-test-remote://test-server/project`. Browse was gated. The tests covered manual image previews, links, workspace-root resolution, temporary unavailability, rename, delete, and pending recovery. Separate path tests cover authority mismatch. |
| Native macOS and Linux | This checkout's execution host was Windows and had no access to either native graphical desktop. No OS/architecture, filesystem, chooser, or screen-reader evidence was collected for those platforms. [Native desktop runbook](#native-macos-and-linux-desktops) |
| VS Code Remote | `wsl.exe --list --verbose` reported WSL uninstalled. OpenSSH was present, with no user SSH configuration or target supplied. Docker and Podman were absent from PATH, and no running container runtime or active Remote workspace was available. [Real Remote runbook](#real-remote-over-wsl-dev-containers-or-ssh) |
| Other Windows filesystems, network or virtual workspaces and browser-only VS Code | Fixed local NTFS remains the only picker gate. Virtual workspaces are supported by the manifest and the Node workspace host provisions the extension. Browser-only VS Code lacks that host. |

The 12 picker cases verify selection in all editing modes, including both Split panes, with percent-encoded Unicode and reserved characters. They compare raw BOM/CRLF and surrounding authored Markdown, exercise native history and exact Save, and compare asset bytes and directory entries. The suite also checks cancellation, stale selection invalidation, competing views, multi-root and junction isolation, invalid or oversized images, changed or missing assets, and read-only Markdown. Other desktop cases exercise commands, keyboard focus, light, dark and high-contrast themes, links, manual previews, and both recovery stores. OS-native dialog presentation and hands-on screen-reader use remain unverified.

The strict fixture passed 44 cases and the native x64 probe reproduced the normalization collision, supporting the existing reference-only decision. [Probe procedure](#milestone-24-local-filesystem-probes) · [Attachment design](extension-attachments.md)

Isolated installs of the exact Milestone 2.7 VSIX passed on 1.147.0 and 1.100.0. Each version opened Markdown in the native editor by default, offered opt-in Folio with all three modes, saved exact BOM/CRLF bytes, and kept Folio disabled in a separate Restricted Mode profile. On 1.147.0, the installed extension selected an existing image through the real Simple File Dialog. The generated percent-encoded relative reference previewed in Split. VS Code Save, Undo, and Redo produced the expected Markdown bytes and preserved asset bytes and directory entries. The 1.147.0 smoke also verified native default for `.markdown` and rendered an ELK-configured Mermaid diagram in Folio. [Artifact and command record](PROJECT_HANDOFF.md#milestone-27-verification)

## Milestone 2.6 environment matrix

| Environment | Evidence and picker availability |
| --- | --- |
| Windows 11 Pro 25H2 x64, build 26200.9974 | Desktop VS Code 1.147.0 x64 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`), Electron 43.8.9 with Chromium 150.0.7871.250 and Node 24.22.1. The client and workspace extension host ran on the same Windows machine. The isolated profiles and `file:` workspaces used a fixed `C:` NTFS volume and empty URI authority. The picker uses the real VS Code file dialog. The desktop suite selects its workbench Simple File Dialog presentation. |
| Windows synthetic provider | `folio-test-remote://test-server/project` ran in the same Windows extension host, backed by fixture memory. The picker refused to open. Desktop tests exercised manual image references, links, same-root resolution, and injected outages. URI-authority rejection also has a separate path unit test. |
| Other Windows filesystems, UNC and mapped network drives, generic and virtual providers | The picker gate excludes these backends. The synthetic provider provides the only new provider-gating evidence in this milestone. |
| Native macOS and native Linux | No graphical desktop on either OS was available. The picker still displays the Windows NTFS requirement. Follow the [native desktop runbook](#native-macos-and-linux-desktops) for the next qualification pass. |
| VS Code Remote for WSL, SSH, or Dev Containers | No active Remote workspace was available. `wsl --list --verbose` reported WSL absent. The SSH client was present, with no user SSH config or target supplied. Docker and Podman were unavailable on `PATH` and no running container runtime was found. The picker refuses Remote windows. Follow the [Remote runbook](#real-remote-over-wsl-dev-containers-or-ssh) per transport and filesystem. |
| VS Code for the Web | The extension has a Node workspace entry point and requires a desktop or server extension host. A browser-only VS Code session cannot activate this VSIX. |

The Windows desktop suite passed 44 tests, including 12 picker cases. The harness uses Node 24.13.0 and npm 11.21.0. Windows tests also cover a failed replacement selection followed by insertion of the previous image using the keyboard. The case compares saved BOM/CRLF Markdown and both asset byte sequences. Windows tests cover accessible names, focus, modal keyboard navigation, and theme updates. OS-native chooser presentation and hands-on screen-reader behavior still need dedicated testing.

The installed VSIX smoke check passed on Windows with VS Code 1.147.0 and the declared minimum, VS Code 1.100.0 x64 (`19e0f9e681ecb8e5c09d8784acaa601316ca4571`, Electron 34.5.1, Chromium 132.0.6834.210, Node 20.19.0). Each isolated profile checked the default native editor, opt-in activation, all three Folio editing modes, and exact BOM/CRLF Save. Separate untrusted profiles on both builds verified that Restricted Mode keeps Folio disabled and the native editor available. The full desktop suite used 1.147.0.

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

Save the following as `fixture.cjs` in a disposable fixture directory, such as `test-results/qualification`. Run `node fixture.cjs folio-qualification` from that parent directory. For Remote, run it from a terminal on the workspace machine.

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
put('root-a/media/invalid.png', '<svg/>')
put('root-a/media/truncated.png', pixel.subarray(0, 8))
put('root-a/media/oversized.png', Buffer.concat([pixel, Buffer.alloc(5 * 1024 * 1024)]))
put('root-b/media/café #%(final)%2F.png', 'wrong root')
put('root-b/media/decoy.png', pixel)
put('expected/edited.txt', source.replace('# Qualification', '# Qualification edited'))
put('qualification.code-workspace', JSON.stringify({ folders: [{ path: 'root-a' }, { path: 'root-b' }] }))
```

For the heading edit, compare raw bytes from the OS or Remote terminal with this command from within the generated directory. Repeat for `.markdown`. Write a separate expected byte fixture for later scenarios before making additional edits.

```sh
node -e "const fs=require('node:fs'); if (!fs.readFileSync(process.argv[1]).equals(fs.readFileSync('expected/edited.txt'))) process.exitCode=1" root-a/docs/folio.md
```

### Picker acceptance on a real host

1. On the current build, open **Browse workspace images** and record how unsupported browsing is explained. Enter a manual reference and verify the installed VSIX still previews it. For a candidate platform qualification, use an instrumented candidate build with the browse gate limited to that target platform and filesystem. Record the candidate commit and whether VS Code shows its workbench chooser or an OS-native dialog. Run the workbench variant and repeat a selection through the OS-native variant where available.
2. Open the fixture from its `.code-workspace` file. In Visual, Source, and both Split panes, put the cursor after `Text with` and select the valid image from `root-a/media`. Check that the URL is `../media/caf%C3%A9%20%23%25%28final%29%252F.png`. Tab to alt text, enter `Picked [raster]`, and press Enter. Verify the intended selection changes and the preview reports the alt text. Save, Undo, and Redo with VS Code. Compare each expected snapshot as raw bytes, including the BOM, CRLF, and the original spacing. Repeat with `.markdown`.
3. Try `root-b/media/decoy.png`, a file outside both workspace folders, and a symlink or junction under `root-a/media` pointing to `root-b/media`. Try `invalid.png`, `truncated.png`, `oversized.png`, and a missing file. For a missing-file confirmation, select the valid image and rename it before pressing Insert, then restore it. Repeat the confirmation with changed asset bytes. Check the text and dirty state after each rejection.
4. Cancel the chooser and the Folio dialog with Escape. In a fresh dialog, pick the valid image, then try the truncated file twice and submit the previous valid selection. Open two Folio views, start browsing in one, and attempt another browse in the other. Change the native document before returning the chooser result. Repeat with a native edit followed by Undo. Require a stale-selection error even if Undo restores the original text.
5. Record asset directory entries and SHA-256 hashes immediately before and after each picker case, excluding deliberate fixture mutations. Compare against the starting values after the intentional changes have been restored. Keep all assets unchanged throughout the ordinary insertion, Save, Undo, and Redo case.

## Native macOS and Linux desktops

1. Record OS version (`sw_vers` on macOS or `/etc/os-release` on Linux), `uname -m`, `code --version`, keyboard layout, `node --version`, and `npm --version`. Record the fixture filesystem and case behavior with `df` and `diskutil info` on macOS or `findmnt -T <fixture>` on Linux. Use a graphical desktop. Install dependencies with `npm ci`, then run `npm run package:extension` and `npm run test:extension`. Set `FOLIO_VSCODE_EXECUTABLE` to the desktop binary if needed. On macOS the default is VS Code's `Contents/MacOS/Electron`. Keep process restart tests confined to the harness profile.
2. Install `extension/dist/folio.vsix` using disposable `--user-data-dir` and `--extensions-dir` values. Open the fixture workspace in that profile. Check both suffixes in the native editor, select **Reopen Editor With → Folio Markdown Editor**, and check **Developer: Show Running Extensions** for activation in the local workspace host. Record the host Node version, OS, architecture, and workspace and document URI schemes and authorities. A disposable diagnostic extension can report `process.versions.node`, `process.platform`, `process.arch`, `vscode.env.remoteName`, and the URI fields.
3. Exercise each editing mode via the editor title's **Folio** submenu, Command Palette, and keyboard. Use Cmd+Option+Shift+V/M/S on macOS or Ctrl+Alt+Shift+V/M/S on Linux. Check focus in the Visual and Source panes. Check Properties and Go to Heading. Use light, dark, high-contrast dark, and high-contrast light themes. Inspect editor focus, selection, menus, and contrast.
4. Confirm the image displays in Visual and Split. Cmd+click or Ctrl+click both links and confirm the destination URI and line. Confirm the out-of-root image is unavailable. Add ` edited` to the heading. Save, Undo, and Redo using the native commands, observing the heading at each step. Save again, verify the exact bytes, and reopen in both editors.
5. Check a second Folio view and changes from the native editor. Run the `recovery.vscode.ts` cases for delayed edits, host restart, and recovery across rename or deletion. Check that unresolved drafts are offered for manual review, the buffer and disk stay authoritative, and a replacement file receives no automatic replay. Use VoiceOver on macOS or the available screen reader on Linux to check mode changes, image dialog focus, errors, alt text, and recovery actions. Record assistive technology and version, test counts, failed cases, and the package version.
6. Run [picker acceptance](#picker-acceptance-on-a-real-host). Qualify each tested filesystem and URI shape before expanding availability.

For local attachment primitives, set `FOLIO_LOCAL_FS_PROBE_DIR` to an existing writable disposable directory on the volume being qualified. Set `FOLIO_QUALIFY_LOCAL_FS=1` and run `npm test -- src/host/vscode/attachmentFilesystem.test.ts`. In PowerShell, set the variables through `$env:`, then clear both after the run. Record the filesystem and Node version. The strict flag makes a missing link primitive a qualification failure. In the ordinary unit run, a filesystem that explicitly refuses the required link operation can skip that probe with a reason.

## Real Remote over WSL, Dev Containers, or SSH

1. Use a disposable machine, WSL distro, or container with the official Remote extension and an isolated VS Code client profile. Connect from VS Code, build the fixture on the workspace side, and open `qualification.code-workspace` in that Remote window. Install the VSIX into the workspace host. Record transport, client version/commit, server version/commit from the Remote output log, client and server OS/architecture and Node versions, backing filesystem, workspace and document URI schemes and authorities, and Folio's placement in **Developer: Show Running Extensions**. Redact private authority values in shared logs. A disposable diagnostic extension can log `vscode.env.remoteName`, `process.platform`, `process.arch`, `process.versions.node`, and the URI scheme and authority of each workspace folder and the active document.
2. Check default and Folio opens for both suffixes. Follow both Markdown links, verify the image resolves to Root A and the boundary image is blocked, and inspect the same names in Root B. Edit from Folio and the native editor separately. Verify both views converge and Save produces the exact expected bytes on the Remote machine, including BOM and CRLF.
3. Open a second Folio view and a native view. Create disjoint edits while the first change is pending and verify both edits. Repeat with overlapping changes and capture the native and Folio snapshots in the recovery view. If the edits settled sequentially, repeat with a delayed transport in the disposable setup. Record the order and exact expected bytes for each result.
4. Briefly make a disposable fixture volume unavailable while keeping the Remote transport connected, if the environment provides a reversible way to do so. Record the failure VS Code actually presents, whether the host stays alive, whether pending Save succeeds on return, and both saved and recovered bytes. A permission failure or `FileNotFound` is a distinct result. Record this case as unverified if there is no way to produce temporary filesystem unavailability.
5. Separately interrupt the real connection during an edit awaiting acknowledgement. Confirm pending status before counting the attempt. Reconnect, note whether the original client and server survived, record which checkpoint was available and compare the complete draft and saved bytes. Then repeat with an actual Remote extension-host restart. Use the disposable connection's host controls and verify that Folio activated in a new host. Confirm the current native buffer and disk remain authoritative and that recovery never replays a draft automatically.
6. Rename the file while Folio is open, reopen the new URI, and check resources again. Delete it, then open a different Markdown file under the same root to find the old recovery record. Recreate the original path with different bytes and check that the old draft stays in review and the new file is untouched.
7. Run [picker acceptance](#picker-acceptance-on-a-real-host) inside the Remote window. Repeat with a second disposable Remote authority or workspace identity containing the same Markdown and image paths with different bytes. Verify that selection and recovery from the first identity cannot apply to the second and that previews resolve on the current host. If the real chooser supports selecting a URI from another authority, attempt it and record the rejection. If the chooser excludes other authorities before a result reaches Folio, record that behavior and retain the separate protocol-level URI check.

The automated desktop harness starts a local test profile and communicates through local fixture files. Use it for native desktops. The synthetic provider suite remains useful for controlled faults alongside the real Remote procedure.
