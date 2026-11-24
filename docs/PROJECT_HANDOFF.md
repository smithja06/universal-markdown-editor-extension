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
| VSIX distribution | `npm run package:extension` bundles the esbuild host and Vite webview under `extension/dist`. VSCE uses `extension/package.json` and its allowlist. The top-level `extension/THIRD_PARTY_NOTICES.md` supplements Vite's generated notice inventory. `docs/extension-distribution.md` traces bundled and compiled third-party components to their inputs and records the conditions for publication. |

See [VS Code architecture and recovery](extension-readiness.md) for the bridge, CSP, and lifecycle details.

## Milestone and Git history

- Standalone Phase 1 built the shared editor and split editing. Phase 2 added version history, Phase 3 added the document workspace, Phase 4 added unified search, and Phase 5 refined standalone behavior, accessibility, and host boundaries.
- Phase 6 Milestone 1 added the optional VS Code editor (`5acf124`). Milestone 1.1 protected pending edits and added lifecycle recovery (`2fd666d`, `dc588dd`). Milestone 2 added native commands, themes, and workspace resources (`2ada555`). Milestone 2.1 improved large-document editing and acknowledgements (`06d1c50`). Milestone 2.2 added provider outage retries and faster Source editing (`95018b5`).
- Milestone 2.3 added Windows desktop and filesystem qualification, provider fault injection, a retention benchmark, and the permanent handoff (`68968a4`, followed by `78fd18e`).
- Milestone 2.4 added filesystem probes, portable path helpers, and manual reference-only insertion (`7028f54`, `c4f4f3e`). Its automatic upload goal remained incomplete after filesystem qualification.
- Milestone 2.5 added a reference-only workspace image picker in the shared dialog and a Source insertion action at `75c94e8`. GitHub pull request #12 merged that commit into `main` at `f03847714d68df1dabcb5091b77f78a49531694a`. The merge tree matches the Milestone 2.5 checkpoint exactly.
- Milestone 2.6 qualified the available Windows desktop, fixed picker replacement and retry behavior, and prepared a local release candidate with platform runbooks and package notices at `b1b5b483583cecaf0d23419eef6d7caf42e17b34`. PR #13 merged it into `origin/main` at `191a07d`, with the same tree as the milestone commit.
- The original checkout is `C:\Users\xxjad\OneDrive\Desktop\Personal VSCode\universal-markdown-editor-extension`. Milestone 2.7 fast-forwarded local `main` to the verified PR #13 merge and began `phase-6-vscode-milestone-2.7` from `191a07d`. It audited source and distribution obligations, added packaged notices, and requalified the Windows release candidate. Run `git log -1 --format=%H -- docs/PROJECT_HANDOFF.md` on the branch for the commit containing this handoff. Preserve prior branches and use the original checkout. The current milestone is local.

## Workspace image picker

In Visual and the Visual pane of Split, select **Insert content → Image or image caption → Browse workspace images**. In Source and the Source pane of Split, use the **Insert image** toolbar action. The picker opens at the Markdown document's own workspace root. A valid selection fills the URL with a document-relative, percent-encoded reference. Enter alt text, then select **Insert** or press Enter. Existing image edits use **Apply**. Manual references and standalone embedded image import remain available.

Browsing is supported in a local Windows extension host for a drive-letter `file:` workspace on fixed NTFS. The picker checks the URI authority, the originating workspace folder, canonical containment, the file type and 5 MiB limit, and a raster signature. The webview also checks that Chromium can decode the selected raster. A cancelled or undecodable replacement preserves the previous decoded selection and its alt text. Folio verifies that asset again at Insert and checks the initiating selection and native revision. The existing edit and recovery paths handle changes that race the final Markdown transaction. Picker state is connection-local and is never replayed.

Folio reads the selected asset. It performs no writes, creates, copies, moves, renames, deletes, or asset-side journaling. The final reference is a path to mutable user-placed content. Local reads compare file handles, metadata, and bytes at validation time. They cannot guarantee that the entire path and file identity stay fixed during concurrent filesystem changes or later previews. [Picker contract](extension-attachments.md#milestone-25-reference-only-picker) [Platform qualification](extension-qualification.md#milestone-25-picker-coverage)

## Milestone 2.4 filesystem decision

Milestone 2.4 established reference-only insertion for existing raster images and fixed dialog submission by click or Enter inside the VS Code sandbox. Native Save and Undo/Redo persist or reverse the reference. Standalone import still embeds images.

Windows NTFS reproduced unsafe path-based staging, publication, and cleanup after path replacement. The native x64 probe used live directory and stage handles, blocked ordinary renames of the held directories, and preserved exact and case-equivalent names. It still published alongside a canonically equivalent NFC/NFD filename. The probe starts from an absolute workspace path. Full ancestor pinning, in-place reparse mutation, and post-restart ownership remain unqualified. An ordinary dedicated assets directory inherits the independent-writer problem. An independently secured service or provider would require a separate identity, protected ancestors, and a controlled namespace. Reference-only insertion avoids introducing a write surface or native dependency. [Threat model, alternatives, and probe evidence](extension-attachments.md#milestone-24-architecture-decision)

Automatic upload remains disabled everywhere. The filename and destination helpers for automatic placement remain test-only. Both Markdown recovery channels cover pending reference edits and preserve unresolved drafts for manual review.

## Known limitations

- Browsing is unavailable on macOS, Linux, real VS Code Remote, virtual and generic providers, network drives, and Windows volumes outside the fixed-NTFS gate. Browser-only VS Code cannot activate the Node extension. Milestone 2.7 had a Windows 11 Pro x64 desktop. Native macOS and Linux desktops, WSL, a configured SSH target, a container runtime, and an active Remote workspace were unavailable. The synthetic provider runs inside the local Windows extension host. Windows OS-native file dialog presentation and hands-on screen-reader use remain unverified. [Platform matrix and runbooks](extension-qualification.md#milestone-27-environment-matrix)
- Automatic attachment writes are disabled on all volumes and providers, including local NTFS, other Windows volumes, UNC/network paths, macOS, Linux, generic and virtual providers, and real Remote. Existing references were verified on local Windows and previewed with the synthetic provider. Provider APIs lack an atomic no-follow read or open. A workspace Markdown link can race a filesystem change after its final check, and a user-placed asset can move or change after the reference is written. [Platform matrix](extension-qualification.md#milestone-24-continuation-coverage)
- Webview checkpoints serialize the full draft synchronously. Large documents can hit browser storage limits, and renderer scheduling can delay acknowledgements. A crash before either store captures the draft, simultaneous storage failure, or unfinished IME input can lose pending input. If a provider outage outlasts the bounded retry, the draft stays available for manual recovery.
- Initial Visual rendering and very large or structural Visual edits can still parse the whole document. Complex edited blocks can still be reserialized when a local source patch cannot round-trip. The repeated-disposal benchmark samples short-lived sessions. The 384-key Visual run delivered every checkpoint but had a 2.43 s checkpoint acknowledgement p95. Post-close retention after sustained Visual editing remains unverified. [Benchmark evidence](extension-benchmarks.md#milestone-27-windows-release-candidate)

## Release readiness

The local Windows release candidate is `smithja06.folio-markdown-editor@0.1.0`. Its host and webview runtime assets match Milestone 2.6 byte-for-byte. The package carries Folio's MIT license, generated dependency and font notices, supplemental source and copyright notices, and the EPL 1.0 text. Folio has no extension telemetry. VS Code manages its own telemetry. Folio keeps recovery copies in webview local storage and VS Code workspace storage. CSP restricts scripts, styles, fonts, and image sources to the packaged UI and permitted raster data. Workspace Trust gates extension activation.

The shipped Mermaid ELK worker contains elkjs and ELK under EPL 2.0, EMF GWT Common and Ecore under EPL 1.0, and Eclipse Xtext Xbase under EPL 2.0. The exact upstream release, source links, and hashes are recorded. The outstanding external distribution blockers are exact build provenance including the MELK snapshot, complete nested runtime notices, and approval and durable delivery of the source companion under the final object-code and release-channel terms. Expanding the picker requires independent real-host qualification. [Release assessment](extension-readiness.md#milestone-27-release-assessment) · [Distribution record and release steps](extension-distribution.md)

## Milestone 2.7 verification

Use Node 22.13+ on the 22.x line or Node 24+ with `npm ci` from the repository root. Milestone 2.7 ran on Windows 11 Pro 25H2 x64 (26200.9974), fixed NTFS, Node 24.13.0 and npm 11.21.0. Chromium was 159.0.8154.6. VS Code desktop 1.147.0 ran the full suite. [Platform matrix](extension-qualification.md#milestone-27-environment-matrix)

| Check | Command | Result |
| --- | --- | --- |
| ESLint | `npm run lint` | Passed |
| TypeScript | `npx tsc --noEmit` and `npx tsc --project extension/tsconfig.json` | Both passed |
| Unit and integration | `npm test` | 148 passed across 15 files |
| Strict filesystem checks | `npm test -- src/host/vscode/attachmentPath.test.ts src/host/vscode/attachmentFilesystem.test.ts` with `FOLIO_QUALIFY_LOCAL_FS=1` and `FOLIO_LOCAL_FS_PROBE_DIR=test-results/milestone-27/strict-fs` | 44 passed across two files on fixed NTFS |
| Native handle probe | `powershell.exe -NoProfile -File tests/vscode/attachment-ntfs.ps1` | Passed and reproduced the NFC/NFD collision boundary |
| Builds | `npm run build` and `npm run build:extension` | Both passed with existing Vite chunk-size warnings |
| Standalone Chromium | `npm run test:e2e -- --workers=6 --output test-results/chromium-27` | 60 passed in 46.2 s |
| VS Code desktop | `npm run test:extension -- --output test-results/desktop-27` | 44 passed in 5.0 min, including 12 picker cases |
| VSIX | `npm run package:extension` | Passed. 185 entries, including 174 webview assets and both notice files. The archive matched the expected files and assets and had no development-only files or common credential signatures. |
| Installed VSIX | `code --user-data-dir $profile --extensions-dir $extensions --install-extension extension/dist/folio.vsix` and `code --user-data-dir $profile --extensions-dir $extensions --list-extensions --show-versions` | Passed in four isolated Windows profiles on VS Code 1.147.0 and 1.100.0. Verified native default, opt-in activation, all three modes, BOM/CRLF Save, and Restricted Mode gating. The 1.147.0 smoke also covered image selection and preview, native history, asset integrity, the `.markdown` suffix, and ELK-configured Mermaid rendering. |

The local VSIX is `extension/dist/folio.vsix`, 3,453,530 bytes. Its SHA-256 is `3150b8a0246f71d9d253cf8f45fc00d424e5525580c1a982cb6c76a41c6d74b7`. The asset and host hashes match Milestone 2.6. [Artifact inventory and recheck procedure](extension-distribution.md)

Run browser checks and desktop checks sequentially with distinct Playwright output directories. Use `npx playwright install chromium` if Chromium is absent, and set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the path from `node -p "require('playwright').chromium.executablePath()"`. Set `FOLIO_VSCODE_EXECUTABLE` if desktop discovery fails. For disposable profiles in this checkout, set `FOLIO_VSCODE_TEST_ROOT=test-results/milestone-27/desktop-fixtures` outside the Playwright output directories.

Repeat the installed check with separate disposable profile and extensions directories. Use the ordinary profile to open a fixture first in the native Text Editor, then via **Reopen Editor With → Folio Markdown Editor**. In another fresh profile enable Workspace Trust and leave the fixture in Restricted Mode. Confirm Folio is absent from the chooser and the native editor remains available. On VS Code versions that accept `--shared-data-dir`, use a disposable directory for it as well. [Picker and raw byte acceptance steps](extension-qualification.md#picker-acceptance-on-a-real-host)

For the seven benchmark cases, use an idle desktop, fresh profiles, `FOLIO_BENCHMARK=1`, and the current extension build. Run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g 'sustained Markdown Source at 5000000 bytes' --repeat-each=3 --output test-results/bench-27-source` with `FOLIO_BENCHMARK_LONG=1`. Clear the long flag and run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts retention.bench.ts -g 'sustained (Visual Editor|Split Editor) at 5000000 bytes|retained memory' --output test-results/bench-27-other`. Restore the long flag and run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g 'sustained Visual Editor at 5000000 bytes' --output test-results/bench-27-long-visual`. Clear both flags for ordinary desktop tests.

Three Source repeats recorded medians of 51.28 ms typing p95 and 26.60 ms checkpoint acknowledgement p95, with all thresholds met. The 16-key Visual and Split smoke tests measured 94.13 and 122.59 ms typing p95. The longer Visual case measured 96.64 ms typing p95, completed all checkpoints, and saved exact Markdown. All 16 short disposal cycles passed. [Full data, prior comparison, and investigation thresholds](extension-benchmarks.md#milestone-27-windows-release-candidate)

## Milestone 2.6 verification

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

Prioritize clearing the Windows distribution blocker. Resolve the ELK worker's exact inputs and complete notices, obtain review of the object-code and channel terms, and verify an accessible release-specific source companion and a rebuilt, matching VSIX. An explicitly approved ELK-free build is a separate release option if provenance cannot be closed. Repeat the isolated Windows package checks and record the final artifact and source checksums before any authorized distribution. [Source and distribution acceptance criteria](extension-distribution.md#requirements-and-release-decision)

When graphical macOS and Linux environments are available, qualify them with the actual VSIX, starting with APFS and ext4 where available. Require OS and host versions, case behavior, real chooser and screen-reader use, root and authority isolation, encoded paths, exact BOM/CRLF and native history, draft review, and unchanged assets. Qualify each real Remote transport separately with reconnect, outage, restart, and authority-change evidence. Expand the gate only for environments that pass. Automatic uploads remain disabled. [Platform runbooks](extension-qualification.md)
