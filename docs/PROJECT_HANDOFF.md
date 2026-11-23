# Folio project handoff

## Product

Folio is a local-first Markdown editor that combines rich document editing with developer-friendly Markdown. Both hosts share the Visual Tiptap editor, CodeMirror Source, synchronized Split view, formatting, tables, task lists, Mermaid, KaTeX, callouts, find/replace, and document properties. Standalone Folio adds an IndexedDB library, tabs, autosave, version history, Markdown and HTML export, and local image import that embeds the bytes. The VS Code extension edits Markdown in the native workspace and previews existing raster images and Markdown links. Use **Reopen Editor With → Folio Markdown Editor** for `.md` or `.markdown`. VS Code's native editor remains the default. DOCX, PDF, TXT, CSV, and XLSX are future format work.

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
| Workspace image references | `src/ui/InsertDialog.tsx` routes explicit button and Enter actions into the shared editor without native form submission in the VS Code sandbox. `src/App.tsx` gates the upload picker on the standalone host. `tests/vscode/native.vscode.ts` covers reference insertion, preview, Save, and Undo/Redo in all three modes. |
| Attachment qualification | `src/host/vscode/attachmentPath.ts` and its tests cover portable destination segments, filenames, candidate selection, and encoded references. `src/host/vscode/attachmentFilesystem.test.ts` and `tests/vscode/attachment-ntfs.ps1` record filesystem probe behavior. |
| Tests and builds | Vitest tests live with the code under `src/`. Standalone Chromium tests are `tests/*.e2e.ts`. Desktop tests and benchmarks are in `tests/vscode/`, with `desktop.ts` and `host.cjs` providing the isolated desktop fixture. `vite.webview.config.ts` bundles the webview. |

See [VS Code architecture and recovery](extension-readiness.md) for the bridge, CSP, and lifecycle details.

## Milestone and Git history

- Standalone Phase 1 built the shared editor and split editing. Phase 2 added version history, Phase 3 added the document workspace, Phase 4 added unified search, and Phase 5 refined standalone behavior, accessibility, and host boundaries.
- Phase 6 Milestone 1 added the optional VS Code editor (`5acf124`). Milestone 1.1 protected pending edits and added lifecycle recovery (`2fd666d`, `dc588dd`). Milestone 2 added native commands, themes, and workspace resources (`2ada555`). Milestone 2.1 improved large-document editing and acknowledgements (`06d1c50`). Milestone 2.2 added provider outage retries and faster Source editing (`95018b5`).
- Milestone 2.3 is the latest completed milestone. It added Windows desktop and filesystem qualification, provider fault injection, a retention benchmark, and the permanent handoff (`68968a4`, followed by `78fd18e`).
- Milestone 2.4 is **incomplete**. Commit `7028f54` contains the filesystem probes, portable path helpers, and picker gate. The continuation began at verified HEAD `b7fff988d5c22ac8a5b39c5478b5a60517306980`, a handoff-only commit after that preparation. The continuation result is the commit containing this handoff. Use `git log -1 --format=%H -- docs/PROJECT_HANDOFF.md` to resolve it in the checkout.
- Original checkout is `C:\Users\xxjad\OneDrive\Desktop\Personal VSCode\universal-markdown-editor-extension`. Use branch `phase-6-vscode-milestone-2.4` in that checkout. It starts at `78fd18e`, which contains `68968a4`. The continuation is a local branch commit. Preserve the existing branch, worktree, and checkpoint history.

## Milestone 2.4 filesystem decision

Folio uses **reference-only insertion** for images in VS Code. Users put a raster image in the workspace, then enter its encoded relative path in **Insert content → Image or image caption** in Visual or the Visual pane of Split, or write the Markdown reference in Source. The dialog now applies by button click or Enter inside the existing webview sandbox. VS Code saves the Markdown, and its Undo/Redo changes the reference while leaving the asset in place. Standalone import still embeds images.

Windows NTFS reproduced unsafe path-based staging, publication, and cleanup after path replacement. The native x64 probe used live directory and stage handles, blocked ordinary renames of the held directories, and preserved exact and case-equivalent names. It still published alongside a canonically equivalent NFC/NFD filename. The probe starts from an absolute workspace path. Full ancestor pinning, in-place reparse mutation, and post-restart ownership remain unqualified. An ordinary dedicated assets directory inherits the independent-writer problem. An independently secured service or provider would require a separate identity, protected ancestors, and a controlled namespace. Reference-only insertion avoids introducing a write surface or native dependency. [Threat model, alternatives, and probe evidence](extension-attachments.md#milestone-24-architecture-decision)

Automatic upload is disabled everywhere. There is no VS Code upload picker, destination setting, binary payload validator, staging or publication service, operation ID, or asset recovery journal. The portable filename and destination helpers remain test-only. Both existing Markdown recovery channels cover pending reference edits and preserve unresolved drafts for manual review. There is no asset-side recovery because Folio never creates, updates, or removes the user-placed file.

## Known limitations

- Native macOS, native Linux, and real VS Code Remote have yet to be qualified. Windows desktop and the synthetic provider have separate coverage in the [platform matrix and runbooks](extension-qualification.md).
- Automatic attachment writes are disabled on all volumes and providers, including local NTFS, other Windows volumes, UNC/network paths, macOS, Linux, generic and virtual providers, and real Remote. Existing references were verified on local Windows and previewed with the synthetic provider. Provider APIs lack an atomic no-follow read or open. A workspace Markdown link can race a filesystem change after its final check, and a user-placed asset can move or change after the reference is written. [Platform matrix](extension-qualification.md#milestone-24-continuation-coverage)
- Webview checkpoints serialize the full draft synchronously. Large documents can hit browser storage limits, and renderer scheduling can delay acknowledgements. A crash before either store captures the draft, simultaneous storage failure, or unfinished IME input can lose pending input. If a provider outage outlasts the bounded retry, the draft stays available for manual recovery.
- Initial Visual rendering and very large or structural Visual edits can still parse the whole document. The repeated-disposal benchmark samples short-lived sessions. Long-running renderer and native memory retention remain unverified.

## Verification

Use Node 22.13+ in the 22.x line or Node 24+ and run `npm ci` from the repository root.

| Check | Command | Milestone 2.4 continuation result |
| --- | --- | --- |
| ESLint | `npm run lint` | Passed |
| TypeScript | `npx tsc --noEmit` and `npx tsc --project extension/tsconfig.json` | Passed |
| Unit and integration | `npm test` | 145 passed across 15 files. |
| Strict local fixture | `npm test -- src/host/vscode/attachmentPath.test.ts src/host/vscode/attachmentFilesystem.test.ts` with the flags in the [qualification runbook](extension-qualification.md#milestone-24-local-filesystem-probes) | 44 passed across two files on NTFS |
| Native handle probe | `powershell.exe -NoProfile -File tests/vscode/attachment-ntfs.ps1` | Passed and reproduced the NFC/NFD collision boundary |
| Standalone build | `npm run build` | Passed |
| Extension build | `npm run build:extension` | Passed |
| Standalone Chromium | `npm run test:e2e -- --workers=12` | 60 passed in 1.5 minutes with the full Playwright Chromium executable selected. The first run used the default headless shell and passed 50 of 60, with 10 timeouts waiting for started downloads to finish. |
| Desktop VS Code | `npm run test:extension` | 32 passed in 3.6 minutes, including the three reference cases. |
| VSIX | `npm run package:extension` | `extension/dist/folio.vsix` contains 181 entries and is 3,411,796 bytes. The opt-in manifest, host bundle, and all three referenced webview assets were inspected. The package installed in an isolated profile. |

Windows 11 Pro 25H2 x64 (26200.9974) used VS Code 1.147.0, Chromium 159.0.8154.6, Node 24.13.0, and npm 11.21.0. Use `npx playwright install chromium`. The successful standalone rerun set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the full browser path returned by `node -p "require('playwright').chromium.executablePath()"`. The failure trace from the first run showed a download event without completion before the test timeout. The desktop harness needs a graphical session and installed VS Code. Set `FOLIO_VSCODE_EXECUTABLE` if discovery fails. Run timing and desktop suites without other build or test jobs. Both Vite builds reported the existing chunk-size warnings.

Desktop coverage includes picker gating, image preview, native Save/Undo/Redo, BOM/CRLF, two Folio views, native and provider changes, rename/delete, and both draft recovery channels after interruption. The three new reference cases verify literal Source input, Visual mouse submission, and Split keyboard submission with an encoded Unicode filename. Each checks the decoded preview, native Undo/Redo, exact saved Markdown and image bytes, and the original asset directory contents. The Visual dialog case reproduced Chromium's blocked native form submission before the fix. Chromium covers standalone image import and reopen, editing modes, library persistence, and export. The filesystem probes reproduced the documented unsafe cases. Automatic attachment selection, publication, and asset recovery have no runtime paths or end-to-end coverage.

To repeat the VSIX smoke check, set `$profile` and `$extensions` to separate directories in a disposable fixture. Run `code --user-data-dir $profile --extensions-dir $extensions --install-extension extension/dist/folio.vsix`, then `code --user-data-dir $profile --extensions-dir $extensions --list-extensions --show-versions`. The installed entry was `smithja06.folio-markdown-editor@0.1.0`.

The three fresh 5 MB Source runs used 384 keys at a 75 ms target cadence. Median typing p95 was 47.10 ms versus 42.13 ms in preparation and 40.88 ms in 2.3. Median checkpoint creation and acknowledgement p95 were 29.40 ms and 22.30 ms, versus 26.00 ms and 20.20 ms in preparation. One run reached 2,864.80 ms acknowledgement p95, with 2,859 ms reply delivery p95. The median stayed below the 2 s investigation threshold. Each run acknowledged 384 checkpoints, recorded zero storage failures, and autosaved exact text. The retention run completed all 16 two-view disposal cycles with zero remaining webview iframes after each close. Post-GC host and workbench heaps ended at 50.25 and 70.59 MiB. [Exact benchmark results and methodology](extension-benchmarks.md#milestone-24-continuation)

To reproduce, build with `npm run build:extension`, set `FOLIO_BENCHMARK=1` and `FOLIO_BENCHMARK_LONG=1`, and run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g "sustained Markdown Source at 5000000 bytes" --repeat-each=3`. With only `FOLIO_BENCHMARK=1`, run `npx playwright test --config playwright.vscode.config.ts retention.bench.ts`. Use `FOLIO_BENCHMARK_BUILD` to measure a prior bundle with the same harness. Clear the benchmark variables before desktop verification. Investigate repeatable 5 MB Source typing p95 above 110 ms, checkpoint creation p95 above 75 ms, acknowledgement p95 above 2 s, startup above 8 s, Source switch above 4 s, or Split switch above 6 s.

## Development rules

- Preserve standalone Folio, IndexedDB persistence, and round-trip Markdown, including BOM, line endings, and unchanged syntax.
- Keep VS Code's `TextDocument` authoritative. Preserve both recovery channels and exact-text acknowledgements. Never silently discard drafts or automatically replay unresolved edits.
- Build on the shared editor and host APIs. Avoid architecture rewrites for isolated extension work.
- Keep milestone work on a dedicated branch. Do not merge into `main` automatically. Update this handoff and linked evidence at each milestone.

## Next milestone

Build a reference-only picker for a raster image that the user has already placed in the current workspace. Start with the local Windows environment. Accept only an explicitly selected existing raster within the initiating document's workspace root and URI authority. Check the existing read boundary and 5 MiB limit, generate an encoded document-relative link, and leave Markdown unchanged for invalid files, unsupported environments, or cancelled selection. Do not perform asset I/O other than reads.

Acceptance includes Visual, Source, and Split, round-trip paths with Unicode and reserved characters, native Save/Undo/Redo, exact Markdown and image bytes, stale positions, competing views and native edits, workspace isolation, and both Markdown recovery channels. Verify that asset directories and bytes remain intact after the action. Keep Remote, automatic writes, paste uploads, and drag-and-drop uploads outside the picker milestone. Revisit automatic writes in a separate milestone only when a specific backend can enforce containment, portable name exclusion, and safe recovery. [Architecture and acceptance criteria](extension-attachments.md#follow-up-scope)
