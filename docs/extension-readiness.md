# Folio in VS Code

## Phase 6 through Milestone 2.5

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
