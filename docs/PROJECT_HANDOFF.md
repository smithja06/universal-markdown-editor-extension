# Folio project handoff

## Product

Folio is a local-first Markdown editor that combines rich document editing with developer-friendly Markdown. Both hosts share the Visual Tiptap editor, CodeMirror Source, synchronized Split view, formatting, tables, task lists, Mermaid, KaTeX, callouts, find/replace, and document properties. Standalone Folio adds an IndexedDB library, tabs, autosave, version history, Markdown and HTML export, and local image import that embeds the bytes. The VS Code extension edits Markdown in the native workspace, previews existing raster images and Markdown links, and offers a reference-only picker on qualified local Windows workspaces. Use **Reopen Editor With → Folio Markdown Editor** for `.md` or `.markdown`. VS Code's native editor remains the default. DOCX, PDF, TXT, CSV, and XLSX are future format work.

## Architecture and entry points

| Area | Where to start |
| --- | --- |
| Shared React and Vite UI | `src/App.tsx`, `src/ui/InsertDialog.tsx`, `src/core/commands.ts`, and `src/host/contracts.ts`. The host adapter specifies document, persistence, resource, search, and clipboard facilities. |
| Tiptap/ProseMirror and CodeMirror 6 | `src/editor/schema.ts`, `src/editor/SourceEditor.tsx`, `src/editor/useDocument.ts`, and `src/editor/visualProjection.ts`. `src/document/markdown.ts` handles CommonMark/GFM parsing and round-trip serialization, including preservation of untouched authored markup. `src/document/files.ts` handles Markdown encoding. |
| Standalone | `index.html` and `src/main.tsx` boot `src/host/browser.ts`. `src/document/workspaceStorage.ts` and `src/document/versions.ts` hold IndexedDB drafts, library state, and history. `src/document/export.ts` handles export. |
| VS Code | `extension/package.json` contributes `folio.markdown` with optional priority. `extension/src/extension.ts` registers the custom editor. `extension/src/webview.ts` serves the restricted webview. `src/host/vscode/main.tsx` and `src/host/vscode/host.ts` bootstrap the same UI. |
| Native synchronization | `src/host/vscode/liveDocument.ts` and `src/host/vscode/protocol.ts` send revision-aware edits. The extension host serializes them through `WorkspaceEdit` and checks the exact text before acknowledgement. The native `TextDocument` owns committed text, save, and Undo/Redo. |
| Pending-edit recovery | `src/host/vscode/recovery.ts`, `src/host/vscode/RecoveryNotice.tsx`, and `extension/src/packedRecovery.ts` support a webview-origin journal and a separate workspace-storage backup. Every new draft generation is checkpointed. Edit acknowledgements bind to connection, document URI, edit ID, revision, and verified proposal text. On conflict, reopen, or restart, unresolved drafts are offered for manual review. |
| Workspace files and resources | `extension/src/resources.ts` resolves images and Markdown links, `src/host/vscode/resourcePath.ts` validates path segments, and `src/host/vscode/resources.ts` handles webview requests. The host uses VS Code provider URIs and bounded native reads for local raster files. |
| Workspace image picker | `extension/src/imagePicker.ts` gates the environment, opens the VS Code chooser, and validates the selected asset. `extension/src/extension.ts` binds selection to a connection and revision. `src/host/vscode/protocol.ts` and `resources.ts` carry picker requests and bounded previews. `src/App.tsx`, `src/ui/Toolbar.tsx`, and `src/ui/InsertDialog.tsx` connect the dialog to the original editor selection. `src/document/markdown.ts` can preserve literal text around an inline image change when the patch round-trips. |
| Image picker regression tests | `tests/vscode/imagePicker.vscode.ts` drives the real VS Code file dialog. `tests/vscode/native.vscode.ts` retains manual-reference and provider preview coverage. `src/host/vscode/protocol.test.ts` and `src/document/markdown.test.ts` cover message validation and authored syntax. |
| Attachment qualification | `src/host/vscode/attachmentPath.ts` and its tests cover portable destination segments, filenames, candidate selection, and encoded references. `src/host/vscode/attachmentFilesystem.test.ts` and `tests/vscode/attachment-ntfs.ps1` record filesystem probe behavior. |
| Tests and builds | Vitest tests live with the code under `src/`. Standalone Chromium tests are `tests/*.e2e.ts`. Desktop tests and benchmarks are in `tests/vscode/`, with `desktop.ts` and `host.cjs` providing the isolated desktop fixture. `vite.webview.config.ts` bundles the webview. |

See [VS Code architecture and recovery](extension-readiness.md) for the bridge, CSP, and lifecycle details.

## Milestone and Git history

- Standalone Phase 1 built the shared editor and split editing. Phase 2 added version history, Phase 3 added the document workspace, Phase 4 added unified search, and Phase 5 refined standalone behavior, accessibility, and host boundaries.
- Phase 6 Milestone 1 added the optional VS Code editor (`5acf124`). Milestone 1.1 protected pending edits and added lifecycle recovery (`2fd666d`, `dc588dd`). Milestone 2 added native commands, themes, and workspace resources (`2ada555`). Milestone 2.1 improved large-document editing and acknowledgements (`06d1c50`). Milestone 2.2 added provider outage retries and faster Source editing (`95018b5`).
- Milestone 2.3 added Windows desktop and filesystem qualification, provider fault injection, a retention benchmark, and the permanent handoff (`68968a4`, followed by `78fd18e`).
- Milestone 2.4 added filesystem probes, portable path helpers, and manual reference-only insertion (`7028f54`, `c4f4f3e`). Its automatic upload goal remained incomplete after filesystem qualification.
- Milestone 2.5 added a reference-only workspace image picker in the shared dialog and a Source insertion action at `75c94e8`. GitHub pull request #12 merged that commit into `main` at `f03847714d68df1dabcb5091b77f78a49531694a`. The merge tree matches the Milestone 2.5 checkpoint exactly.
- Milestone 2.6 qualifies the available Windows desktop, fixes picker replacement and retry behavior, and prepares a local release candidate with platform runbooks and package notices. The original checkout is `C:\Users\xxjad\OneDrive\Desktop\Personal VSCode\universal-markdown-editor-extension`. Local `main` fast-forwarded to `f038477`, and `phase-6-vscode-milestone-2.6` began there. Run `git log -1 --format=%H -- docs/PROJECT_HANDOFF.md` for the verified milestone commit that contains this handoff. Preserve earlier milestone branches and checkpoints. `git worktree list` showed only this checkout during integration.

## Workspace image picker

In Visual and the Visual pane of Split, select **Insert content → Image or image caption → Browse workspace images**. In Source and the Source pane of Split, use the **Insert image** toolbar action. The picker opens at the Markdown document's own workspace root. A valid selection fills the URL with a document-relative, percent-encoded reference. Enter alt text, then select **Insert** or press Enter. Existing image edits use **Apply**. Manual references and standalone embedded image import remain available.

Browsing is supported in a local Windows extension host for a drive-letter `file:` workspace on fixed NTFS. The picker checks the URI authority, the originating workspace folder, canonical containment, the file type and 5 MiB limit, and a raster signature. The webview also checks that Chromium can decode the selected raster. A cancelled or undecodable replacement preserves the previous decoded selection and its alt text. Folio verifies that asset again at Insert and checks the initiating selection and native revision. The existing edit and recovery paths handle changes that race the final Markdown transaction. Picker state is connection-local and is never replayed.

Folio reads the selected asset. It performs no writes, creates, copies, moves, renames, deletes, or asset-side journaling. The final reference is a path to mutable user-placed content. Local reads compare file handles, metadata, and bytes at validation time. They cannot guarantee that the entire path and file identity stay fixed during concurrent filesystem changes or later previews. [Picker contract](extension-attachments.md#milestone-25-reference-only-picker) [Platform qualification](extension-qualification.md#milestone-25-picker-coverage)

## Milestone 2.4 filesystem decision

Milestone 2.4 established reference-only insertion for existing raster images and fixed dialog submission by click or Enter inside the VS Code sandbox. Native Save and Undo/Redo persist or reverse the reference. Standalone import still embeds images.

Windows NTFS reproduced unsafe path-based staging, publication, and cleanup after path replacement. The native x64 probe used live directory and stage handles, blocked ordinary renames of the held directories, and preserved exact and case-equivalent names. It still published alongside a canonically equivalent NFC/NFD filename. The probe starts from an absolute workspace path. Full ancestor pinning, in-place reparse mutation, and post-restart ownership remain unqualified. An ordinary dedicated assets directory inherits the independent-writer problem. An independently secured service or provider would require a separate identity, protected ancestors, and a controlled namespace. Reference-only insertion avoids introducing a write surface or native dependency. [Threat model, alternatives, and probe evidence](extension-attachments.md#milestone-24-architecture-decision)

Automatic upload remains disabled everywhere. The filename and destination helpers for automatic placement remain test-only. Both Markdown recovery channels cover pending reference edits and preserve unresolved drafts for manual review.

## Known limitations

- Browsing is unavailable on macOS, Linux, real VS Code Remote, virtual and generic providers, network drives, and Windows volumes outside the fixed-NTFS gate. Browser-only VS Code cannot activate the Node extension. The machine available for Milestone 2.6 ran Windows 11 Pro x64. There was no native macOS or Linux desktop, installed WSL, configured SSH target, container runtime, or Remote workspace. The synthetic provider runs inside the local Windows extension host. The OS-native file dialog presentation and hands-on screen-reader use have no dedicated Milestone 2.6 coverage. [Platform matrix and runbooks](extension-qualification.md#milestone-26-environment-matrix)
- Automatic attachment writes are disabled on all volumes and providers, including local NTFS, other Windows volumes, UNC/network paths, macOS, Linux, generic and virtual providers, and real Remote. Existing references were verified on local Windows and previewed with the synthetic provider. Provider APIs lack an atomic no-follow read or open. A workspace Markdown link can race a filesystem change after its final check, and a user-placed asset can move or change after the reference is written. [Platform matrix](extension-qualification.md#milestone-24-continuation-coverage)
- Webview checkpoints serialize the full draft synchronously. Large documents can hit browser storage limits, and renderer scheduling can delay acknowledgements. A crash before either store captures the draft, simultaneous storage failure, or unfinished IME input can lose pending input. If a provider outage outlasts the bounded retry, the draft stays available for manual recovery.
- Initial Visual rendering and very large or structural Visual edits can still parse the whole document. Complex edited blocks can still be reserialized when a local source patch cannot round-trip. The repeated-disposal benchmark samples short-lived sessions. Long-running renderer and native memory retention remain unverified.

## Release readiness

The extension README and changelog describe desktop installation, commands, workspace image constraints, Trust, and recovery. The VSIX packages the MIT license, bundled dependency notices including the fonts, and supplemental source and copyright notices. Folio has no extension telemetry. VS Code manages telemetry and keeps recovery metadata in workspace storage. The webview retains its restricted CSP and extension asset root. Windows keyboard and theme coverage supports local RC testing. Expanded platform support requires native qualification. External binary distribution requires reviewing the final artifact's EPL corresponding source and notices for the chosen release channel. [Release assessment](extension-readiness.md#milestone-26-release-assessment)

## Verification

Use Node 22.13+ in the 22.x line or Node 24+ and run `npm ci` from the repository root.

| Check | Command | Milestone 2.6 result |
| --- | --- | --- |
| ESLint | `npm run lint` | Passed |
| TypeScript | `npx tsc --noEmit` and `npx tsc --project extension/tsconfig.json` | Passed |
| Unit and integration | `npm test` | 148 passed across 15 files. |
| Strict local fixture | `npm test -- src/host/vscode/attachmentPath.test.ts src/host/vscode/attachmentFilesystem.test.ts` with the flags in the [qualification runbook](extension-qualification.md#milestone-24-local-filesystem-probes) | 44 passed across two files on NTFS |
| Native handle probe | `powershell.exe -NoProfile -File tests/vscode/attachment-ntfs.ps1` | Passed and reproduced the NFC/NFD collision boundary |
| Standalone build | `npm run build` | Passed |
| Extension build | `npm run build:extension` | Passed |
| Standalone Chromium | `npm run test:e2e -- --workers=6 --output test-results/chromium-26` | 60 passed in 50.9 seconds, including standalone embedded image import. |
| Desktop VS Code | `npm run test:extension -- --output test-results/desktop-26` | 44 passed in 5.5 minutes, including 12 picker cases. |
| VSIX | `npm run package:extension` | `extension/dist/folio.vsix` contains 184 entries and is 3,447,840 bytes. Archive checks verified the opt-in manifest, license and notices, host bundle, webview entry, and all three directly referenced webview assets. Isolated installs on VS Code 1.147.0 and 1.100.0 verified native default, Folio activation, all three editing modes, and exact BOM/CRLF Save. Both versions disabled Folio in Restricted Mode. |
| Runtime dependency advisories | `npm audit --omit=dev --json` | The registry reported zero advisories for the audited production tree during Milestone 2.6. |

Windows 11 Pro 25H2 x64 (26200.9974) ran the full desktop suite on VS Code 1.147.0 with fixed NTFS and a local Node 24.22.1 extension host. The harness used Node 24.13.0 and npm 11.21.0. The standalone run used Chromium 159.0.8154.6. Use `npx playwright install chromium` and set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the full browser path from `node -p "require('playwright').chromium.executablePath()"`. Set `FOLIO_VSCODE_EXECUTABLE` if desktop VS Code discovery fails. Set `FOLIO_VSCODE_TEST_ROOT=test-results/desktop-26-fixtures` to keep disposable profiles and workspaces in the checkout. Run timing benchmarks without competing build or test jobs. Both Vite builds reported the existing chunk-size warnings.

Run the browser and desktop suites sequentially with distinct output directories. Playwright cleans its output path at startup. The desktop fixture root must stay outside both job output directories.

The picker cases drive the real VS Code chooser with the workbench's Simple File Dialog setting. They check native selection replacement and preview in Visual, Source, and both Split panes, exact BOM/CRLF and list syntax, native Undo/Redo and Save, unchanged asset bytes and directory entries, cancellation, competing views, stale revisions, changes to the selected file, invalid rasters, and valid and invalid choices in a multi-root window. Existing desktop cases cover manual references, native and provider changes, and both Markdown recovery channels after interruption. Chromium covers standalone image import and reopen, editing modes, library persistence, and export. [Desktop platform evidence](extension-qualification.md#milestone-25-picker-coverage)

To repeat the VSIX smoke check, set `$profile` and `$extensions` to separate directories in a disposable fixture. Run `code --user-data-dir $profile --extensions-dir $extensions --install-extension extension/dist/folio.vsix`, then `code --user-data-dir $profile --extensions-dir $extensions --list-extensions --show-versions`. The installed entry was `smithja06.folio-markdown-editor@0.1.0`. Open a disposable workspace with the same profile flags, open a Markdown fixture in the native editor, and use **Reopen Editor With → Folio Markdown Editor**. Check Visual, Source, and Split, then save a Source edit and compare the file's raw bytes.

For the Trust check, use another fresh profile with Workspace Trust enabled. On versions that accept `--shared-data-dir`, point it to a disposable directory as well. Open the fixture in Restricted Mode, confirm that Folio is absent from the editor chooser, and verify that the native editor still opens the file. The verified VSIX SHA-256 is `9ca69f3ec2ff0863839318fa4b869694ed26bffe75f98d38df2758fd54374123`.

The benchmark harness passed 20 cases, including six runs of the preserved Milestone 2.5 bundle. All 5 MB Source runs delivered 384 checkpoints to both stores, and each typing case autosaved exact Markdown. The initial 2.6 median for Source was 102.14 ms typing p95 and 1,368.80 ms checkpoint acknowledgement p95. In the follow-up, the preserved bundle and 2.6 medians were 54.46 → 48.47 ms typing p95, 31.90 → 23.70 ms checkpoint acknowledgement p95, and 89.12 → 90.23 ms Visual typing p95. Every 2.6 Source recheck met the existing thresholds. Split recorded 140.34 ms typing p95 in one smoke run. All 16 measured disposal cycles passed. [Milestone 2.6 data and comparison](extension-benchmarks.md#milestone-26-release-candidate) [Preserved Milestone 2.5 evidence](extension-benchmarks.md#milestone-25-workspace-image-picker)

To reproduce, build with `npm run build:extension`, set `FOLIO_BENCHMARK=1` and `FOLIO_BENCHMARK_LONG=1`, and run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g "sustained Markdown Source at 5000000 bytes" --repeat-each=3`. With only `FOLIO_BENCHMARK=1`, run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts retention.bench.ts -g 'sustained (Visual Editor|Split Editor) at 5000000 bytes|retained memory'`. Use `FOLIO_BENCHMARK_BUILD` to measure a prior bundle with the same harness. Clear the benchmark variables before desktop verification. Investigate repeatable 5 MB Source typing p95 above 110 ms, checkpoint creation p95 above 75 ms, acknowledgement p95 above 2 s, startup above 8 s, Source switch above 4 s, or Split switch above 6 s.

## Development rules

- Preserve standalone Folio, IndexedDB persistence, and round-trip Markdown, including BOM, line endings, and unchanged syntax.
- Keep VS Code's `TextDocument` authoritative. Preserve both recovery channels and exact-text acknowledgements. Never silently discard drafts or automatically replay unresolved edits.
- Build on the shared editor and host APIs. Avoid architecture rewrites for isolated extension work.
- Keep milestone work in the original checkout on a dedicated branch. Preserve previous milestones and obtain explicit authorization before pushing, publishing, or integrating new milestone work into `main`. Update this handoff and linked evidence at each milestone.

## Next milestone

Recommended Milestone 2.7 is native macOS and Linux qualification on available graphical desktops, starting with APFS and ext4 where available. Install the actual VSIX in isolated profiles and record OS, architecture, VS Code build, Node, filesystem, and URI identity. Require real chooser selection, keyboard and screen-reader use, same-root and authority isolation, symlink and missing-file rejection, encoded relative paths, exact BOM/CRLF Save and Undo/Redo, multi-view and stale-revision safety, draft recovery, and unchanged asset bytes and directory entries. Expand the gate only for environments that pass. Qualify each real Remote transport separately with disconnect, reconnect, outage, host restart, and authority-change evidence. Keep automatic uploads disabled pending a separately qualified backend. [Platform runbooks](extension-qualification.md)
