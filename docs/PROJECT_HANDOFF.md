# Folio project handoff

## Product

Folio is a local-first Markdown editor with a rich Visual surface, CodeMirror source editing, and synchronized Split view. Standalone Folio includes a document library, tabs, search, version history, Markdown and HTML export, and local image import. The VS Code extension brings the shared editor to open workspace documents. VS Code's native editor remains the default for `.md` and `.markdown`. DOCX, PDF, TXT, CSV, and XLSX are future format work.

## Architecture and entry points

| Area | Where to start |
| --- | --- |
| Shared React and Vite UI | `src/App.tsx`, `src/ui/`, and `src/host/contracts.ts`. The host adapter specifies document, persistence, resource, search, and clipboard facilities. |
| Tiptap/ProseMirror and CodeMirror 6 | `src/editor/schema.ts`, `src/editor/SourceEditor.tsx`, `src/editor/useDocument.ts`, and `src/editor/visualProjection.ts`. `src/document/markdown.ts` handles CommonMark/GFM parsing and round-trip serialization. `src/document/files.ts` handles Markdown encoding. |
| Standalone | `index.html` and `src/main.tsx` boot `src/host/browser.ts`. `src/document/workspaceStorage.ts` and `src/document/versions.ts` hold IndexedDB drafts, library state, and history. `src/document/export.ts` handles export. |
| VS Code | `extension/package.json` contributes `folio.markdown` with optional priority. `extension/src/extension.ts` registers the custom editor. `extension/src/webview.ts` serves the restricted webview. `src/host/vscode/main.tsx` and `src/host/vscode/host.ts` bootstrap the same UI. |
| Native synchronization | `src/host/vscode/liveDocument.ts` and `src/host/vscode/protocol.ts` send revision-aware edits. The extension host serializes them through `WorkspaceEdit` and checks the exact text before acknowledgement. The native `TextDocument` owns committed text, save, and Undo/Redo. |
| Pending-edit recovery | `src/host/vscode/recovery.ts`, `src/host/vscode/RecoveryNotice.tsx`, and `extension/src/packedRecovery.ts` support webview-origin journals and workspace-storage backups. On a conflict, reopen, or restart, unresolved drafts are offered for manual review. |
| Workspace files and resources | `extension/src/resources.ts` resolves images and Markdown links, `src/host/vscode/resourcePath.ts` validates path segments, and `src/host/vscode/resources.ts` handles webview requests. The host uses VS Code provider URIs and bounded native reads for local raster files. |
| Tests and builds | Vitest tests live with the code under `src/`. Standalone Chromium tests are `tests/*.e2e.ts`. Desktop tests and benchmarks are in `tests/vscode/`, with `desktop.ts` and `host.cjs` providing the isolated desktop fixture. `vite.webview.config.ts` bundles the webview. |

See [VS Code architecture and recovery](extension-readiness.md) for the bridge, CSP, and lifecycle details.

## Development status

- Standalone Phases 1–5 are complete. Phase 6 delivered the optional VS Code editor (1), pending-edit recovery (1.1), native commands and workspace resources (2), large-document and acknowledgement improvements (`06d1c50`, 2.1), and provider outage retries and Source performance (`95018b5`, 2.2).
- Current branch is `phase-6-vscode-milestone-2.3`. Milestone 2.3 adds platform and filesystem qualification, a retention benchmark, and attachment implementation boundaries. The last approved checkpoint before 2.3 is `95018b5` on `phase-6-vscode-milestone-2.2`.
- Latest verified Milestone 2.3 qualification commit is `68968a4`. The VSIX is built at `extension/dist/folio.vsix`.
- Recommended next milestone is Phase 6 Milestone 2.4, local workspace image insertion, subject to the backend prerequisites below.

## Known limitations

- Native macOS, native Linux, and real VS Code Remote have yet to be qualified. Windows desktop and the synthetic provider have separate coverage in the [platform matrix and runbooks](extension-qualification.md).
- Workspace attachment insertion is disabled. Local NTFS demonstrated exclusive staging and no-overwrite publication. Safe containment and cleanup across parent replacement remain open. Generic provider and Remote insertion are unsupported. [Filesystem boundaries](extension-attachments.md#milestone-23-qualification-decision)
- Webview checkpoints serialize the full draft synchronously. Large documents can hit browser storage limits, and renderer scheduling can delay acknowledgements. A crash before either store captures the draft, simultaneous storage failure, or unfinished IME input can lose pending input. If a provider outage outlasts the bounded retry, the draft stays available for manual recovery.
- Very large or structural Visual edits can still reparse the whole document. The repeated-disposal benchmark samples short-lived sessions. Long-running renderer and native memory retention remain unverified.

## Verification

Use Node 22.13+ in the 22.x line or Node 24+ and run `npm ci` from the repository root.

| Check | Command | Milestone 2.3 result |
| --- | --- | --- |
| ESLint | `npm run lint` | Passed |
| TypeScript | `npx tsc --noEmit` and `npx tsc --project extension/tsconfig.json` | Passed |
| Unit and integration | `npm test` | 104 passed across 14 files |
| Standalone build | `npm run build` | Passed |
| Extension build | `npm run build:extension` | Passed |
| Standalone Chromium | `npm run test:e2e -- --workers=12` | 60 passed |
| Desktop VS Code | `npm run test:extension` | 29 passed |
| VSIX | `npm run package:extension` | Packaged and installed into an isolated Windows profile |

Use `npx playwright install chromium` for standalone tests or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. The desktop harness needs a graphical session and an installed VS Code binary. Set `FOLIO_VSCODE_EXECUTABLE` if discovery fails. Windows qualification used VS Code 1.147.0 and Chromium 159.0.8154.6. Run timing and desktop suites without other build or test jobs. Chromium's offline export case previously timed out under concurrent load. Checkpoint reply timing varies with renderer scheduling and garbage collection.

See [benchmark commands, results, and thresholds](extension-benchmarks.md). To reproduce the large-document comparison, build each revision, set `FOLIO_BENCHMARK=1` and `FOLIO_BENCHMARK_LONG=1`, and run `npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g "sustained Markdown Source at 5000000 bytes" --repeat-each=3`. With only `FOLIO_BENCHMARK=1`, run `npx playwright test --config playwright.vscode.config.ts retention.bench.ts`. Use `FOLIO_BENCHMARK_BUILD` to measure a prior bundle with the same harness. Clear the benchmark variables before desktop verification. Sustained timing cases must acknowledge every checkpoint, report zero storage failures, and autosave exact text. Investigate repeatable 5 MB Source typing p95 above 110 ms, checkpoint creation p95 above 75 ms, acknowledgement p95 above 2 s, startup above 8 s, Source switch above 4 s, or Split switch above 6 s.

## Development rules

- Preserve standalone Folio, IndexedDB persistence, and round-trip Markdown, including BOM, line endings, and unchanged syntax.
- Keep VS Code's `TextDocument` authoritative. Preserve both recovery channels and exact-text acknowledgements. Never silently discard drafts or automatically replay unresolved edits.
- Build on the shared editor and host APIs. Avoid architecture rewrites for isolated extension work.
- Keep milestone work on a dedicated branch. Do not merge into `main` automatically. Update this handoff and linked evidence at each milestone.

## Next milestone

Start with a backend qualification for a specific local filesystem. Demonstrate directory containment through staging, publication, and cleanup, exclusive staging creation, same-directory no-overwrite publication, duplicate-name handling, and identity-based recovery after interruption. If containment or cleanup cannot be enforced, keep that destination unavailable. Complete the native and Remote runbooks as environments become available.

Once a backend qualifies, implement the local-client picker, 5 MiB raster validation, safe names, a relative reference, and publication before the revision-checked native Markdown edit. Acceptance requires exact file and Markdown bytes, collisions and parallel requests across two views, recovery before staging/during writes/after publication, and native Undo/Redo preserving the asset when the reference is undone. Provider-backed insertion requires its own backend qualification. [Attachment design and acceptance tests](extension-attachments.md)
