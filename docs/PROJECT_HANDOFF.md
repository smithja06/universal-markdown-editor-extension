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
| Attachment preparation | `src/host/vscode/attachmentPath.ts` and its tests cover portable destination segments, filenames, candidate selection, and encoded references. `src/host/vscode/attachmentFilesystem.test.ts` and `tests/vscode/attachment-ntfs.ps1` record filesystem probe behavior. `src/App.tsx` gates the picker on the standalone host. |
| Tests and builds | Vitest tests live with the code under `src/`. Standalone Chromium tests are `tests/*.e2e.ts`. Desktop tests and benchmarks are in `tests/vscode/`, with `desktop.ts` and `host.cjs` providing the isolated desktop fixture. `vite.webview.config.ts` bundles the webview. |

See [VS Code architecture and recovery](extension-readiness.md) for the bridge, CSP, and lifecycle details.

## Milestone and Git history

- Standalone Phase 1 built the shared editor and split editing. Phase 2 added version history, Phase 3 added the document workspace, Phase 4 added unified search, and Phase 5 refined standalone behavior, accessibility, and host boundaries.
- Phase 6 Milestone 1 added the optional VS Code editor (`5acf124`). Milestone 1.1 protected pending edits and added lifecycle recovery (`2fd666d`, `dc588dd`). Milestone 2 added native commands, themes, and workspace resources (`2ada555`). Milestone 2.1 improved large-document editing and acknowledgements (`06d1c50`). Milestone 2.2 added provider outage retries and faster Source editing (`95018b5`).
- Milestone 2.3 is the latest completed milestone. It added Windows desktop and filesystem qualification, provider fault injection, a retention benchmark, and the permanent handoff (`68968a4`, followed by `78fd18e`).
- Milestone 2.4 is **incomplete**. Its preparatory commit is the commit containing this handoff, with subject `Prepare Folio Milestone 2.4 attachment qualification`. Resolve its hash with `git log -1 --format=%H --grep='^Prepare Folio Milestone 2.4 attachment qualification$' phase-6-vscode-milestone-2.4`.
- Original checkout is `C:\Users\xxjad\OneDrive\Desktop\Personal VSCode\universal-markdown-editor-extension`. Branch `phase-6-vscode-milestone-2.4` starts directly at `78fd18e`, which contains `68968a4`. The branch remains local and unmerged. The server's `main` at `0d14a74` already includes 2.3 via PR #10. Local `main` (`ad019f9`) and the `origin/main` tracking ref (`00dd789`) were behind the server at verification. Work in the original checkout and preserve its other refs.

## Milestone 2.4 filesystem decision

The VS Code picker and upload input are hidden. The existing image reference dialog and workspace image rendering still work. No supported environment can write attachments. The lexical helpers validate literal workspace-relative settings, normalize filenames to NFC, choose bounded candidates from a listing, and generate same-root relative paths verified against the existing resolver. They run in tests only while the feature is gated.

Windows NTFS reproduced unsafe path-based staging, publication, and cleanup after path replacement. An x64 native probe held directory handles without delete sharing, rejected ordinary renames during the operation, detected a junction without following it, and published with matching file identities without replacing an existing or case-equivalent name. Deleting the stage through its live handle preserved the final bytes. NTFS still accepted canonically equivalent NFC/NFD filenames. The probe starts from a disposable absolute workspace path. Full ancestor pinning, in-place reparse mutation, and ownership and cleanup after restart remain unqualified. [Filesystem evidence and proposed operation model](extension-attachments.md#milestone-24-qualification-result)

There is no attachment write protocol, settings UI, payload validator, operation ID, or asset recovery journal. The proposed asset journal is separate from Markdown draft recovery and must classify ownership before any retry or cleanup. A future Undo should remove the reference and keep the asset. Reopen and restart must never apply a saved insertion position automatically.

## Known limitations

- Native macOS, native Linux, and real VS Code Remote have yet to be qualified. Windows desktop and the synthetic provider have separate coverage in the [platform matrix and runbooks](extension-qualification.md).
- Attachment insertion is disabled on all volumes and providers, including Windows NTFS, UNC/network paths, generic and virtual providers, and real Remote. Provider preview remains supported where the provider can resolve the resource. Provider APIs lack a fully atomic no-follow read or open. A workspace Markdown link can race a filesystem change after its final check. [Filesystem boundaries](extension-attachments.md#filesystem-boundary)
- Webview checkpoints serialize the full draft synchronously. Large documents can hit browser storage limits, and renderer scheduling can delay acknowledgements. A crash before either store captures the draft, simultaneous storage failure, or unfinished IME input can lose pending input. If a provider outage outlasts the bounded retry, the draft stays available for manual recovery.
- Initial Visual rendering and very large or structural Visual edits can still parse the whole document. The repeated-disposal benchmark samples short-lived sessions. Long-running renderer and native memory retention remain unverified.

## Verification

Use Node 22.13+ in the 22.x line or Node 24+ and run `npm ci` from the repository root.

| Check | Command | Milestone 2.4 result |
| --- | --- | --- |
| ESLint | `npm run lint` | Passed |
| TypeScript | `npx tsc --noEmit` and `npx tsc --project extension/tsconfig.json` | Passed |
| Unit and integration | `npm test` | 145 passed across 15 files. Added 38 lexical path and filename cases plus three Node filesystem probes. |
| Strict local fixture | `npm test -- src/host/vscode/attachmentPath.test.ts src/host/vscode/attachmentFilesystem.test.ts` with the flags in the [qualification runbook](extension-qualification.md#milestone-24-local-filesystem-probes) | 44 passed across two files on NTFS |
| Native handle probe | `powershell.exe -NoProfile -File tests/vscode/attachment-ntfs.ps1` | Passed and reproduced the NFC/NFD collision boundary |
| Standalone build | `npm run build` | Passed |
| Extension build | `npm run build:extension` | Passed |
| Standalone Chromium | `npm run test:e2e -- --workers=12` | 60 passed |
| Desktop VS Code | `npm run test:extension` | 29 passed |
| VSIX | `npm run package:extension` | `extension/dist/folio.vsix` contains 181 entries. The opt-in manifest, host bundle, and referenced webview assets were inspected. The package installed in an isolated profile. |

Windows 11 Pro 25H2 x64 (26200.9974) used VS Code 1.147.0, Chromium 159.0.8154.6, Node 24.13.0, and npm 11.21.0. Use `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. The desktop harness needs a graphical session and installed VS Code. Set `FOLIO_VSCODE_EXECUTABLE` if discovery fails. Run timing and desktop suites without other build or test jobs. Both Vite builds reported the existing chunk-size warnings.

Desktop regression coverage includes picker gating and image preview, native Save/Undo/Redo, BOM/CRLF, two Folio views, native and provider changes, rename/delete, and both draft recovery channels after interruption. Chromium covers standalone image import and reopen, editing modes, library persistence and export. The picker regression failed on the starting build because the action was visible and passed after the gate. The filesystem probes passed by reproducing the documented unsafe cases. This milestone has no end-to-end attachment publication, insertion, or asset recovery tests because those runtime paths are absent.

To repeat the VSIX smoke check, set `$profile` and `$extensions` to separate directories in a disposable fixture. Run `code --user-data-dir $profile --extensions-dir $extensions --install-extension extension/dist/folio.vsix`, then `code --user-data-dir $profile --extensions-dir $extensions --list-extensions --show-versions`. The installed entry was `smithja06.folio-markdown-editor@0.1.0`.

The three fresh 5 MB Source runs used 384 keys at a 75 ms target cadence. Median typing p95 was 42.13 ms versus the historical 2.3 result of 40.88 ms. All runs acknowledged 384 checkpoints, had zero storage failures, and autosaved exact text. The retention run passed all 16 two-view disposal cycles and had zero remaining webview iframes after each close. [Benchmark results and methodology](extension-benchmarks.md#milestone-24-preparation)

To reproduce, build with `npm run build:extension`, set `FOLIO_BENCHMARK=1` and `FOLIO_BENCHMARK_LONG=1`, and run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g "sustained Markdown Source at 5000000 bytes" --repeat-each=3`. With only `FOLIO_BENCHMARK=1`, run `npx playwright test --config playwright.vscode.config.ts retention.bench.ts`. Use `FOLIO_BENCHMARK_BUILD` to measure a prior bundle with the same harness. Clear the benchmark variables before desktop verification. Investigate repeatable 5 MB Source typing p95 above 110 ms, checkpoint creation p95 above 75 ms, acknowledgement p95 above 2 s, startup above 8 s, Source switch above 4 s, or Split switch above 6 s.

## Development rules

- Preserve standalone Folio, IndexedDB persistence, and round-trip Markdown, including BOM, line endings, and unchanged syntax.
- Keep VS Code's `TextDocument` authoritative. Preserve both recovery channels and exact-text acknowledgements. Never silently discard drafts or automatically replay unresolved edits.
- Build on the shared editor and host APIs. Avoid architecture rewrites for isolated extension work.
- Keep milestone work on a dedicated branch. Do not merge into `main` automatically. Update this handoff and linked evidence at each milestone.

## Next milestone

Resume Milestone 2.4 with qualification for a specific local backend. Start with the NTFS probes and check a trusted-volume root and the entire ancestor chain, reparse mutation and directory replacement, exclusive staging, anchored no-overwrite publication, atomic handling of normalization/case equivalents under independent writers, and identity-safe cleanup or explicit ambiguity after restart. A candidate must prove these guarantees on the stated OS and filesystem before the picker is enabled.

After qualification, add the local-client picker, independent host raster validation with the 5 MiB cap, workspace-derived destination, idempotent asset-operation journal, and revision-checked insertion after publication. Acceptance covers all three editor modes, current and stale selections, concurrent views and native edits, exact BOM/CRLF and asset bytes, permission and interruption recovery, and native Save/Undo/Redo with the installed image retained on Undo. Keep generic providers, Remote, paste, drag-and-drop, other formats, collaboration, and cloud sync outside this work. Consider a separate milestone only after local qualification and delivery. [Attachment design and acceptance tests](extension-attachments.md)
