# Folio in VS Code

## Phase 10.1 release candidate assessment

Engineering qualification for the claimed Windows scope is complete after the acceptance round 1 and 2 fixes, the table picker and DOCX formatting: lint and both tsc clean; 327/327 unit; 103/103 Chromium; full desktop 89/89 on 1.147.0 in one run; installed VSIX 34/34 on each of 1.100.0, 1.147.0 and 1.148.0; Word 16.0 reads the DOCX formatting fixture correctly. Excel 365 validation passed. Personal acceptance testing passed in round 3 with no issues. Version 1.0.0 is authorized. The source companion is published by the release workflow beside the GitHub Release. Release needs the owner's merge to `main`, the one-time Trusted Publishing policy and `marketplace` environment, and the `v1.0.0` tag. See the [Phase 10.1 record](phase-10.1-release-qualification.md).

## Phase 10 release assessment

**Verdict: not ready for public release.** The engineering scope is implemented and verified on Windows. Three items remain. [Phase 10 record](phase-10-final-integration.md#15-remaining-release-blockers)

| Priority | Finding |
| --- | --- |
| Release blocking | **Publication step.** Host the hash-verified ELK source companion (`npm run source:companion`) at a durable public URL, record it in `THIRD_PARTY_NOTICES.md`, rebuild and recheck the artifact. This needs the user's authorization. |
| Release blocking | **Interactive reruns.** Rerun the PDF clipboard desktop case and the Excel 365 reader check on an unlocked session. The last session refused all clipboard access, and Excel automation could not read opened workbooks. |
| Release scope | **Platforms.** Only Windows 11 x64, fixed NTFS and local `file:` is qualified, on VS Code 1.100.0, 1.147.0 and 1.148.0. macOS, Linux, WSL and Remote are unqualified and must not be claimed. On those hosts the native Save gate falls back to reviewed copies. |
| Accepted by the user | Untagged PDF export for 1.0, disclosed as not PDF/UA. Reviewed-copy-only DOCX and XLSX on unqualified platforms. |
| Tracked after 1.0 | Tagged PDF, a text-backed Folio CSV grid, LibreOffice interoperability, a full manual toolbar and high-contrast screen-reader pass, and the bimodal Source switch time. |

**Native binary Save in VS Code.** `folio.docx`, `folio.xlsx` and `folio.csv` implement `saveCustomDocument` and `saveCustomDocumentAs` through `extension/src/binarySave.ts`. The gate requires Windows, a local extension host, a drive-letter `file:` URI without authority, a fixed NTFS volume (CIM query) and local profile storage. Desktop VS Code reports global storage as `vscode-userdata:`, which maps to the profile directory. `verifiedReplace.ts` checks the expected SHA-256 and writes in place under one exclusive handle, journals before writing, restores on failure, and classifies stopped writes on reopen. The first in-place Save per opened version asks for confirmation and lists what the rewrite drops. Save As writes only new files. Known external changes, files held by other apps and unqualified environments refuse Save and keep the draft and its checkpoint. Dirty state follows content, so Undo past a save point keeps a checkpoint. After Save As, VS Code opens the new file in its default editor because Folio editors are opt-in.

**Webview.** pdf.js now loads its legacy build (core-js polyfills) for Chromium 132 in VS Code 1.100. Shared color choices are read when an editor mounts. The CSP, Workspace Trust and resource roots are unchanged.

## Phase 9 spreadsheet editors

Open a local file in a trusted workspace and choose **Reopen Editor With** to use Folio’s optional XLSX or CSV editor. It shares the standalone grid, workbook tools, formula bar and worksheets. The extension host owns revisions and checkpoints, reports native dirty state, provides undo and redo and supports revert and hot-exit backup. Export publishes a reviewed copy to a new local file. The original remains available after external changes and while recovering a backup. [Spreadsheet architecture](phase-9-spreadsheets.md) · [Desktop qualification](extension-qualification.md#phase-9-spreadsheet-qualification)

## Phase 8 PDF viewer and PDF copies

`folio.pdf` is an optional `CustomReadonlyEditorProvider` registered in `extension/src/pdfEditor.ts`. It reads trusted local `file:` documents with the same bounded, change-checked reader as DOCX (64 MiB) and keeps the bytes and their SHA-256 in the custom document. The webview receives a transferable copy over the existing connection-tagged protocol (`pdfState`, `pdfBytes`, `pdfReload`, `copy`). Its `PdfWorkspace` shell renders the shared viewer without a native-text bridge, recovery journal or workspace resources. The provider never writes the workspace file and has no edit events, dirty state, Save or backup. A directory watcher and focus check compare the file's digest and show a banner after replacement or deletion. **Reload from disk** reads and validates the current file before replacing the displayed revision. Closing the editor disposes the watcher and listeners, and the webview's `pagehide` unmounts the viewer, which destroys the pdf.js document and worker.

PDF export from the Markdown, TXT and DOCX editors runs in the webview. The webview sends `pdfExport` with the reviewed bytes, a validated single filename and the native revision it captured. The text provider compares that revision with `TextDocument.version`, and the DOCX provider compares it with its custom document revision. Both check before and after VS Code's save dialog. `extension/src/newFile.ts` creates the destination exclusively, flushes and reads it back, and removes only an incomplete file it created. A destination that already exists is refused even when the user confirmed replacement in the dialog. Non-local destinations are refused. The source document is never written. [Phase 8 architecture](phase-8-pdf.md) · [Phase 8 qualification](extension-qualification.md#phase-8-pdf-qualification)

## Phase 7C text and binary editors

The three editors have optional priority under **Reopen Editor With**. TXT uses the native `TextDocument` provider and the existing revision and exact-acknowledgement bridge. A strict read of the original bytes checks the local native buffer's supported encoding and line-ending configuration while the UI continues to read and edit the native buffer. The TXT recovery scope and Memento prefix are distinct from Markdown. Markdown commands and image browsing stay on the Markdown editor registration.

DOCX uses a separate binary `CustomEditorProvider`. Folio renders the Phase 7B model and shared Tiptap tools in the same webview. The host retains the original bytes, package fingerprint, import notes, canonical rich model, and revision independent of the view. The existing splice protocol carries a bounded serialization of the rich model. The host validates the entire proposed model and exact canonical representation before acknowledging it. A competing rich edit requires review. Each accepted edit emits a native edit event with fingerprint-checked inverse and forward ranges. Native hot exit stores the exact original with the draft and starts a new history at the recovered revision.

Pending DOCX edits use the webview journal and workspace Memento. The extension also records each acknowledged dirty revision before emitting the edit event. A native backup can lag that checkpoint. Folio preserves the newer or divergent record for review and requires a matching original-package fingerprint for applying a journal-only draft. A backup includes its URI, revision, journal ID and original package digest. Recoverable content can still be reviewed when a replacement cannot be parsed. A host stop can leave an orphaned custom editor tab until it is closed. These profile stores contain document content. A crash before checkpointing or loss of profile storage can limit recovery.

Folio compares SHA-256 of the current local file with the originally read package when it observes file changes and when the editor gains focus. **File → Revert to disk** covers clean and dirty drafts. Revert loads and validates before replacing the in-memory revision. VS Code 1.147.0 clears native history before its asynchronous dirty Revert callback returns. Folio retains the draft and reestablishes a recovery edit when an invalid replacement prevents Revert. [Pinned VS Code lifecycle](https://github.com/microsoft/vscode/blob/8a14f0cc1b08d531eb83255ea3764ae22aa932b5/src/vs/workbench/api/browser/mainThreadCustomEditors.ts#L770-L788)

Native Save and Save As reject without writing. An expected digest checked before a provider write only observes an earlier filesystem state. The supported copy workflow captures the native revision before review, runs the same semantic write/reimport validation as standalone, and returns bytes only while the captured revision is current. The download is a separate copy and the custom document stays dirty. The VS Code file dialog and workspace providers receive no DOCX package writes. The native backup callback writes only in VS Code's profile storage.

Workspace Trust and the CSP remain in force. Non-file and Remote DOCX URIs receive an unsupported explanation. Local package reads have a 24 MiB limit, canonical workspace snapshots have a 12 Mi UTF-16 code-unit limit, and native backup records have a 96 MiB limit. The on-demand Node codec runs locally with a 25-second limit per job and at most four concurrent jobs. The qualified host and remaining gaps are recorded with test evidence. [Phase 7C qualification](extension-qualification.md#phase-7c-multi-format-qualification)

## Phase 6 through Milestone 2.7

The extension registers `folio.markdown` as an optional `CustomTextEditorProvider` for `.md` and `.markdown`. VS Code continues to open Markdown in the native Text Editor by default. **Reopen Editor With → Folio Markdown Editor** opens the shared Folio interface with Visual, Markdown, and Split views. [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)

Build with `npm run build:extension`. Start an Extension Development Host from the repository root with `code --extensionDevelopmentPath="$(pwd)/extension"`. For a local install, `npm run package:extension` builds `extension/dist/folio.vsix`.

## Shared editor and host adapters

| Area | Implementation |
| --- | --- |
| Editing surface | Both entry points use `src/App.tsx`, `src/editor/useDocument.ts`, Tiptap, CodeMirror, and the same Markdown parser and serializer. The VS Code adapter supplies a single live document. Each view has its own mode, cursor, and scroll. |
| Standalone storage | `src/host/browser.ts` retains the IndexedDB workspace, local appearance preferences, document library, exports, and version history. |
| VS Code adapter | `src/host/vscode/host.ts` supplies the live document, clipboard, session-local preferences, and cancellable search worker to the shared host interfaces. `extension/src/extension.ts` uses VS Code for document editing and saving. VS Code owns tabs, dirty state, undo, redo, and persisted files. |

## Native commands, themes, and workspace resources

The VS Code Command Palette and editor title’s **Folio** submenu expose Visual, Markdown Source, Split, Document Properties, Go to Heading, and Folio’s own command list when Folio is active. Mode shortcuts use Ctrl+Alt+Shift+V, M, or S on Windows and Linux and Cmd+Option+Shift+V, M, or S on macOS. The standard VS Code Command Palette shortcut remains available. Folio runs Save, Undo, and Redo through the shared buffer after pending input settles.

Folio follows the active VS Code color theme, including light and dark high-contrast themes. Workbench tokens set the webview’s backgrounds, text, borders, selections, menus, and focus outlines. Editor font, spacing, and layout controls remain available in Folio’s Properties panel. Standalone Folio retains its appearance controls and IndexedDB storage. [VS Code theme color reference](https://code.visualstudio.com/api/references/theme-color)

Inline workspace images render in Visual and Split views. Ctrl+click on Windows or Linux and Cmd+click on macOS opens relative `.md` and `.markdown` links from Folio’s Visual or Markdown panes. A leading slash resolves from the containing workspace folder. Other paths resolve relative to the Markdown file and may navigate to its parent directories within the workspace. Outside a workspace, paths are confined to the document’s own directory. VS Code opens the target in its editor, with heading fragments and `#L<number>` supported. Folio stores the original Markdown reference in the editor model.

On local Windows with a fixed NTFS workspace, **Insert content → Image or image caption → Browse workspace images** selects an existing raster from the current document's workspace folder. In Source and the Source pane of Split, start with **Insert image** in the toolbar. The dialog fills a relative reference and lets you edit alt text before selecting **Insert** or pressing Enter. You can also enter the reference manually. If the document or selection changes while the dialog is open, reopen it at the current selection. Folio checks the selected file again at Insert. [Picker contract and limitations](extension-attachments.md#milestone-25-reference-only-picker)

The host preserves the document URI’s scheme and authority and uses VS Code’s workspace API for provider-backed files. Image requests allow raster formats up to 5 MiB. The webview deduplicates repeated references and limits concurrent requests. Resolution rejects out-of-root paths, symbolic links, encoded separators, unsupported formats, and URI schemes supplied by the document. Local raster reads verify canonical containment and read through a bounded file handle. The webview receives raster data URLs under its existing CSP, so workspace folders stay outside `localResourceRoots`. Provider file APIs lack atomic no-follow reads, and VS Code opens Markdown targets by URI after revalidation. Concurrent filesystem changes around that final open remain a limitation. Reference-style and wiki links retain their Markdown syntax. [VS Code remote extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions)

## Synchronization and recovery

The extension host binds a session to a `TextDocument`. Each webview connection sends edits tagged with the base version and a rising request ID. The host serializes edits from all views, checks the document version immediately before `WorkspaceEdit`, and acknowledges a successful edit only once the resulting native text exactly matches the proposal. The accepted reply carries the edit ID and document metadata. Folio uses its matching in-flight proposal as the accepted text after checking the connection, URI, edit ID, and revision. Rejections and external changes still carry native text. A status request can retrieve the last edit acknowledgement and current state. If the request times out, Folio preserves the draft for review and asks the host to cancel any application it has yet to start. [VS Code document and workspace APIs](https://code.visualstudio.com/api/references/vscode-api)

Every new draft generation is recorded synchronously in the webview's origin storage and sent immediately to the host for backup in VS Code workspace storage. This includes keystrokes that arrive while the previous edit is awaiting acknowledgement or when webview storage fails. The host can persist a compact, self-contained backup with a compressed copy of the connection’s initial text and a replacement range. Larger changes, missing bases, and conflicts use a full snapshot. Both stores are scoped to the workspace and keyed by the view's recovery ID. The host rejects older checkpoint generations and compares cleanup requests against both the stored record and the latest generation submitted by the active view. A storage acknowledgement only confirms the matching draft generation. The corresponding recovery record is cleared after synchronization or explicit discard. VS Code's normal dirty-buffer, save, and hot-exit behavior applies to committed edits. [VS Code webview origin persistence](https://code.visualstudio.com/updates/v1_73#_consistent-origin-for-webviews-and-webview-views)

`onDidChangeTextDocument` publishes native edits, undo, redo, and external file reloads accepted by VS Code. The view can rebase provably disjoint ranges. Overlap pauses editing in that view and records the complete Folio draft and the exact native Markdown at detection. Each snapshot retains its line endings and BOM metadata. The bridge uses LF-normalized text with UTF-16 offsets and VS Code retains the original file encoding when it saves.

On reopen, Folio displays the current VS Code document alongside any unresolved drafts. **View pending Markdown** and **Copy pending draft** let you inspect and reconcile the proposed text manually. Conflict records also expose the preserved VS Code version. **Discard pending draft** clears the recovery record after review. Drafts from renamed or deleted files retain their original URI and are accessible by opening another Markdown file in Folio in the same workspace. Recovery records are never replayed, including when a different file later occupies the original path.

Folio's Save, Undo, and Redo wait for its pending edits to settle. A native save can only save the text VS Code has received. An edit that arrives afterward can make the document dirty again. Undo grouping follows the submitted workspace edits. Coalesced edits that span a wide range can require manual reconciliation even when a finer merge could resolve them.

Milestone 2.2 retries an explicit `FileSystemError.Unavailable` from the pre-edit `workspace.fs.stat` for up to three seconds while the request and connection are still active. A session that opened on a known filesystem still verifies the URI if the provider unregisters. Each retry is a stat, so the host still checks the current document revision immediately before any edit. A missing file invalidates the session. A prolonged outage leaves the draft in recovery for manual reconciliation. Checkpoints continue as input arrives, including during the verification wait. A provider RPC that never returns is subject to the existing client timeout and abandon flow. The public `stat` API provides no cancellation token. [VS Code FileSystem API](https://code.visualstudio.com/api/references/vscode-api#FileSystem)

The synchronous webview journal still serializes each changed snapshot. Storage quotas and unusually large documents can affect typing latency or leave only one recovery copy. Folio warns when the current draft has no confirmed recovery copy. A renderer or system crash before either store records or flushes the draft, simultaneous storage failure, profile-data removal, and input still held by an IME can lose changes. Losing an acknowledgement or interrupting cleanup can leave a recovery copy for text that reached VS Code.

For Visual edits, the shared serializer can replace an isolated plain-text Markdown block while keeping the authored prefix, suffix, and surrounding bytes. It requires a single same-markup block with an unchanged surrounding document and safe blank-line boundaries. Structural changes, markup, and ambiguous cases still use the full round-trip validation. CodeMirror source edits continue to use their exact text. The extension host also reuses normalized native text for repeated operations on the same document version.

## Typing and checkpoint benchmark

See the [extension benchmarks](extension-benchmarks.md) for sustained Source, Visual, and Split runs, queue timing, and the Milestone 2.2 comparison. The original Milestone 2 figures below retain their burst workload and comparison baseline.

The benchmark ran on Windows 11 with desktop VS Code 1.147.0 and one worker on an AMD Ryzen AI 9 HX 370. Each size opened in an isolated VS Code profile, warmed up the Markdown Source pane, then issued 64 individual keystrokes without waiting for the preceding edit to be acknowledged. The baseline was the approved Milestone 1.1 tree. The final measurements use the compact host backup.

| Markdown size | Typing p50 / p95 (ms) | Local storage p95 (ms) | Host backup acknowledgement p95 (ms) | Host CPU (ms) | Host RSS change (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 KB | 9.87 / 14.88 → 7.10 / 11.06 | 0.3 → 0.2 | 56.8 → 161.9 | 640 → 438 | +31.9 → +15.8 |
| 500 KB | 12.27 / 26.50 → 9.43 / 13.12 | 0.6 → 0.5 | 81.7 → 42.4 | 313 → 219 | +47.6 → +37.8 |
| 1 MB | 18.83 / 35.21 → 15.16 / 31.90 | 3.4 → 2.3 | 290.1 → 145.3 | 672 → 282 | +77.6 → +38.1 |
| 2 MB | 32.00 / 52.71 → 41.61 / 57.07 | 5.9 → 5.7 | 718.0 → 1,417.5 | 1,532 → 422 | +43.9 → +23.8 |

Typing measures the input round trip through Playwright. Local storage measures `setItem` alone. Host backup acknowledgement includes workbench IPC and renderer scheduling. RSS is sampled at the start and end of the burst and is sensitive to garbage collection. Compact backups cut the 2 MB checkpoint submission p95 from 5.5 to 0.2 ms and reduced host CPU by 72%. The 2 MB typing p95 and the 100 KB and 2 MB acknowledgement p95s were higher in this sample. The synchronous webview snapshot and full document state updates still scale with document size. A first experiment that coalesced backup writes produced slower tails and was removed.

Run the isolated benchmark from PowerShell with `$env:FOLIO_BENCHMARK = '1'; npm run test:extension`. Clear the environment variable before running the ordinary desktop suite. The benchmark covers synthetic Markdown Source input and process snapshots. Long sessions, Visual-mode timing, and documents larger than 2 MB were outside this measurement.

## Webview security

The provider rewrites trusted, built assets with `asWebviewUri`, restricts `localResourceRoots` to the webview bundle, and starts the Content Security Policy at `default-src 'none'`. It permits scripts from the approved webview resource origin, a bundled blob worker for regex, and inline styles used by CodeMirror and rich formatting. Remote images and general network requests are blocked by the policy. The bridge validates connection envelopes, message shapes, revisions, and edit bounds. It binds each active checkpoint to the host-assigned recovery ID and current text document URI. Recovery previews render as plain text, and the workspace backup uses local VS Code storage without Settings Sync. These recovery stores contain readable Markdown, so they share the sensitivity of the original document. Panel subscriptions, client timers, and file watchers are released with their owners. [VS Code webview security](https://code.visualstudio.com/api/extension-guides/webview#security)

## Tests and qualification

Run `npm run test:extension` with desktop VS Code installed. `FOLIO_VSCODE_EXECUTABLE` can point to the application binary. The harness installs the production build into an isolated desktop profile and uses real buffer, panel, file, window, and extension-host operations. Its recovery fixtures can independently hold edit messages, block host checkpoints, or disable webview storage writes. The standalone commands remain `npm test`, `npm run build`, and `npm run test:e2e`.

Windows desktop coverage uses a real VS Code window. The multi-root fixture combines a local workspace folder with a synthetic non-file provider with its own authority and root. It exercises provider-native resource reads, exact saves, rename and deletion, and temporary and prolonged `Unavailable` failures. It verifies that a short outage preserves a pending edit and its queued Save, an overlapping native edit preserves both versions, and a prolonged outage leaves a host-backed draft on reopen. The separate restart cases kill the actual Windows extension host in a local workspace. Native macOS, native Linux, and real VS Code Remote remain unverified.

### Milestone 2.2 verification

Windows 11 Pro 25H2 x64 (26200.9974) ran desktop VS Code 1.147.0 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`) and standalone Chromium 159.0.8154.6 with Node 24.13.0 and npm 11.21.0. WSL was absent, no Docker runtime or SSH host was configured, and no native macOS or Linux desktop was available.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm test` | 100 passed across 13 files |
| `npm run build` | Standalone TypeScript and production build passed |
| `npm run test:extension` | Extension TypeScript and production build passed. All 26 desktop tests passed, including three new provider outage cases. |
| `npm run test:e2e -- --workers=12` | All 60 standalone Chromium tests passed |
| `npm run package:extension` | Passed. The 181-entry VSIX contains the opt-in manifest, extension host, webview entry, and referenced assets. |
| Benchmark suite | Both revisions passed 19 standard and four longer cases. Measurements and thresholds are in the [benchmark report](extension-benchmarks.md). |

### Milestone 2.3 qualification

The Windows desktop suite covers extension activation, native commands, editing modes, theme integration, exact saves, rename and delete, pending-edit recovery, and a real local extension-host restart. The added synthetic-provider cases pin down the `WorkspaceEdit.createFile` race boundary, concurrent no-overwrite rename behavior for the test provider, and failures after partial writes or publication. A provider-backed `.markdown` case verifies image loading with an encoded Unicode name and an exact BOM/CRLF save. See the [platform coverage and runbooks](extension-qualification.md).

### Milestone 2.4 attachment status

VS Code supports references to existing workspace images. Place the raster file in the workspace, then use **Insert content → Image or image caption** in Visual or the Visual pane of Split, or write the relative Markdown reference in Source. The dialog now applies by button click or Enter inside the existing webview sandbox, where native form submission is blocked. Visual and Split preview supported images. Native Save persists the Markdown, and Undo/Redo affects the reference without touching the image. Standalone Folio still offers **Image from file** and embeds the bytes.

Milestone 2.4 remains incomplete. Automatic image placement and its upload picker are disabled for every filesystem and provider. The continuation selected reference-only insertion after comparing the handle-anchored NTFS probe, an independently enforced destination, and the existing reference flow. NTFS still admits normalization-equivalent names, and containment from a trusted volume root and post-restart ownership remain unqualified. The existing two Markdown recovery channels cover reference edits. There is no asset-operation recovery because Folio does not stage or publish assets. [Architecture and next milestone](extension-attachments.md#milestone-24-architecture-decision) [Verification and handoff](PROJECT_HANDOFF.md)

### Milestone 2.5 picker verification

The desktop suite drives VS Code's built-in Simple File Dialog through the production `showOpenDialog` call. It covers Visual, Source, both editing panes across the Split and manual-reference cases, cancel, competing views, stale revisions, asset changes, and rejection at the workspace and raster boundaries. References use native Save and Undo/Redo, with byte comparisons for BOM/CRLF, authored Markdown, and the selected asset. The synthetic provider verifies that browsing is gated and manual preview still works. [Desktop coverage](extension-qualification.md#milestone-25-picker-coverage) [Verification and handoff](PROJECT_HANDOFF.md)

## Milestone 2.6 release assessment

See the [Milestone 2.7 decision](#milestone-27-release-assessment) for the current release status.

| Priority | Finding |
| --- | --- |
| Release blocking for expanded picker support | Native macOS, native Linux, and real Remote need their own VSIX and filesystem qualification. The picker gate stays limited to local Windows fixed NTFS. Any Remote qualification also needs real disconnect, reconnect, extension-host restart, and workspace identity checks. [Platform record and runbooks](extension-qualification.md#milestone-26-environment-matrix) |
| Release blocking before external binary distribution | Verify the final distribution's notices and corresponding source availability for EPL-covered ELK components. The VSIX now carries Vite's generated license inventory, supplemental copyrights for CSS and older dependency metadata, and pinned upstream source references. Review the exact artifact and source availability for the distribution channel before publishing. [Supplemental notices](../extension/THIRD_PARTY_NOTICES.md) [EPL-2.0 distribution terms](https://www.eclipse.org/legal/epl/epl-v20.html) |
| Important but nonblocking on qualified Windows | A decoded picker selection now survives a cancelled or undecodable replacement. The focused desktop regression reproduces the former expiry and checks keyboard submission, raw Markdown bytes, and unchanged assets. Visibility and focus are automated, including high-contrast themes. Hands-on screen-reader and OS-native chooser presentation still need coverage. |
| Important but nonblocking on qualified Windows | Exact-edit verification, conflict review, native history, and both draft journals protect routine edits and provider interruptions. Abrupt loss before a checkpoint lands, simultaneous storage failures, and unfinished IME input remain possible loss windows. Structural Visual edits can reserialize the affected block. Users can use Source for precise authored syntax. |
| Important but nonblocking on qualified Windows | Large Visual edits still incur renderer acknowledgement tails. Short repeated view disposal samples cover activation and cleanup, with long-session renderer memory use still open. [Benchmarks and investigation thresholds](extension-benchmarks.md) |
| Important but nonblocking on qualified Windows | Restricted Mode disabled the installed VSIX on Windows in VS Code 1.147.0 and 1.100.0, with the native editor available. The webview CSP and resource roots stay confined to the bundled UI and validated raster data. File and provider reads observe mutable paths, so revalidation narrows the read window and references can change after insertion. [VS Code Workspace Trust guide](https://code.visualstudio.com/api/extension-guides/workspace-trust) [Attachment boundary](extension-attachments.md#milestone-25-reference-only-picker) |
| Future enhancement | Longer memory profiling, native dialog and assistive-technology coverage across qualified hosts, and transport-specific automation. Automatic uploads require a separate filesystem architecture that establishes containment, collision handling, and ownership after a restart. |

The extension README covers installation, native editor opt-in, platform and Trust limitations, installable build steps, and draft recovery. Folio adds no extension telemetry or general webview network access. VS Code manages its own telemetry settings. The VSIX carries the extension MIT license and bundled dependency notices. The release material uses text instructions and the existing project documentation.

## Milestone 2.7 release assessment

The Windows release candidate is available for local validation as `smithja06.folio-markdown-editor@0.1.0`. Its host bundle and all 174 webview assets match Milestone 2.6 byte-for-byte. The package adds source references and license notices for the EPL 2.0 ELK and Xbase runtime and EPL 1.0 EMF GWT runtime, plus attribution for FastDom and other bundled inputs. The distribution record gives exact versions, artifact and source hash checks, and the steps to prepare and verify the source companion. The exact MELK build input, complete runtime notice closure, and public delivery terms and source arrangement need review before external distribution. [Distribution record](extension-distribution.md) · [Final verification](PROJECT_HANDOFF.md#milestone-27-verification)

Windows qualification covers local fixed NTFS through the real VS Code Simple File Dialog. Native macOS and Linux desktops and genuine Remote transports remain unqualified. Hands-on use with assistive technology and the Windows OS-native dialog presentation remain open. [Environment matrix and runbooks](extension-qualification.md)
