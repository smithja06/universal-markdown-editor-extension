# Phase 10 progress checkpoint

This is a resumable checkpoint for Phase 10 final integration. Phase 10 is **not finished**. The final record `docs/phase-10-final-integration.md` has not been written yet, and the handoff, capability matrix, readiness, qualification and distribution documents have not been updated for Phase 10.

## Starting point

- Branch: `phase-10-final-integration`, created in the original checkout from `origin/main` at `98cd8ed`.
- `98cd8ed` is the PR #20 merge of Phase 9.1 (VS Code appearance, Open with Folio, spreadsheet auto-fit). Its first parent is the Phase 9 merge `cd3474c` (PR #19), which contains the Phase 9 commit `e311c4d`.
- Folio branched from the latest merged `main` rather than from `cd3474c`, so that the merged Phase 9.1 work is kept.
- Local `main` is stale at `0de941b`. It was not modified.
- `KNO3 DATA.xlsx` belongs to the user. It stays untracked and has never been committed.
- Nothing has been pushed, merged, tagged or published.

## Done

| Commit | Work | Evidence |
| --- | --- | --- |
| `7b6745d` | **Native Save and Save As for DOCX, XLSX and CSV** custom documents. Applies to a local drive-letter `file:` on a fixed NTFS volume in a local Windows extension host. `extension/src/verifiedReplace.ts` opens the file with libuv's exclusive lock (`0x10000000`, share mode 0), checks the expected SHA-256 through that handle and writes in place under the same lock. It then flushes, reads back, and restores the previous bytes on failure. A save journal in global storage (`save-journals/`) lets the next open classify a stopped write and reopen the content being saved as an unsaved draft. The first in-place Save of each opened version shows a modal confirmation listing what the original loses. Save As writes only new files. Files open in other apps, known external changes and unqualified environments refuse Save and keep the draft. Dirty state now follows content, so Undo past a save point keeps the recovery checkpoint. Status labels: “Saved to file”, “Unsaved · draft recoverable”, “Draft only · not saved to file”. The spreadsheet webview journal stores a checksum-verified splice above 2 MiB and shows “Syncing · not yet recoverable” when it holds no copy. | 9 real-NTFS unit tests (`src/host/vscode/verifiedReplace.test.ts`) cover a competing process holding the file, external write/delete/rename-over blocked during the save, rollback and crash classification. Journal tests (`spreadsheetJournal.test.ts`). 5 desktop cases (`tests/vscode/binarySave.vscode.ts`) cover cancel and confirm, a locked file, external replacement, Save As refusing an existing file, interrupted-save recovery, XLSX Undo past the save point, and CSV exact bytes. 25 existing DOCX and spreadsheet desktop cases passed after updating labels. |
| `f356c5c` | **Formula autocomplete.** The catalog grows from 15 to 61 functions, each evaluated through Folio's worker against IronCalc 0.9.1 with a pinned result. Date functions are unsupported in 1904 workbooks. The formula bar and cell editor get suggestions, descriptions, active-argument hints and unsupported-function warnings, with Arrow, Tab/Enter and Esc. | `formulaCatalog.test.ts`, `formulaAssist.test.ts`, Chromium case in `tests/spreadsheet.e2e.ts` |
| `cb725f4` | **Formula-aware row and column insert/delete and sheet rename** through IronCalc's reference displacement. Only changed reference tokens are written into the user's text. INDIRECT, OFFSET, external or structured references, and text IronCalc cannot parse refuse with an explanation. Sheet delete keeps the guarded rewrite, because IronCalc leaves references to a deleted sheet unchanged. `moveSheet` is not used because it broke the model in a probe. | `restructure.test.ts` covers relative, absolute and mixed references, ranges, cross-sheet references, #REF!, refusals and an XLSX round trip. Chromium case covers Undo. |
| `6895e42` | **DOCX column widths** are modeled, written as gridCol/tcW in twips (exact px×15), use fixed layout when complete and are read back. Pointer resize is enabled. **Table controls** gain Widen, Narrow and Reset column width as a keyboard path. A Tiptap 3.35 stale-width rendering bug is fixed with a TableView subclass. A **Markdown bug** is fixed: DOMPurify stripped `colwidth`, so a resized Markdown table made the draft unsaveable. | `write.test.ts` and `read.test.ts` width cases, `markdown.test.ts` width cases, Chromium cases in `docx.e2e.ts` and `editor.e2e.ts` (pointer, keyboard, Undo/Redo, export, reimport, reload) |
| `33ba137` | **PDF glyphs.** DejaVu Sans is added as a proportional fallback (same pinned package, notices updated). Uncovered characters (CJK, emoji) print as a searchable `[U+4E2D]` marker instead of a blank. **PDF navigation metadata:** `/Lang` from Markdown `lang:` front matter or the reader's locale, DisplayDocTitle, and a nested heading outline (bookmarks). PDFs remain **untagged** because pdfmake 0.3.14 emits no structure tree, and the tagged flag is not set. | `pdfExport.test.ts` covers multi-script extraction, markers, Lang, title and nested outline. 8 PDF Chromium cases passed. |
| `41d0ee7` | **Workbook themes (codec only).** `Workbook.theme` is read with IronCalc `getTheme` and written with `setTheme`, and validated. The built-in list is snapshotted and tested against `getThemeList()`. A warning appears only for a non-default theme font scheme. | `xlsx.test.ts` workbook theme cases |

At `41d0ee7`: `npm run lint` passed, `npx tsc --noEmit` passed, `npx tsc --project extension/tsconfig.json` passed, and `npm test` reported 313 passed in 36 files.

## Remaining, in order

1. **Workbook theme UI.** Add a “Workbook theme…” dialog from IronCalc's built-in themes, theme swatches in `ColorDialog`, theme-derived accent presets in the Cell styles menu, a note that existing RGB cell colors do not recolor, and a Chromium test.
2. **CSV native TextDocument evaluation (6.5).** Decide and document the outcome. The text editor stays the default. Native CSV Save through the Folio custom editor now exists, rewriting the CSV literally with the original dialect and disclosing non-round-trippable quoting.
3. **Toolbar and UX polish pass (6.4, 11).** Verify every spreadsheet control and Markdown image and Mermaid parity (section 8). Fix whatever is found.
4. **Full clean regression run** on the final source: lint, both tsc, `npm test`, full Chromium, full desktop suite (portable 1.147.0, see below), production builds, `npm run package:extension`.
5. **Installed VSIX smoke** on 1.147.0 and the **oldest declared 1.100.0** (`engines.vscode ^1.100.0`), including the native-save cases.
6. **Benchmarks** (existing harness, see handoff).
7. **Independent readers.** Word and Excel 365 are on this machine. Open the native-saved DOCX and XLSX read-only (no macros or external content), plus the PDFs with pypdf and Windows.Data.Pdf. LibreOffice was previously unavailable.
8. **Distribution.** Inventory the VSIX against the allowlist, compute checksums, confirm DejaVuSans.ttf is in the export chunk and the notices, and keep the ELK/MELK source-companion and pdfmake polyfill-version items open.
9. **Documentation.** Write `docs/phase-10-final-integration.md` (all 18 sections). Update the handoff, the capability matrix (separate rows per the brief), readiness, qualification, distribution and the format docs. Remove or fold in this progress file.

## Decisions made

- Phase 10 branched from `98cd8ed`, the latest merged `main` containing the Phase 9 merge, not from `cd3474c`.
- **In-place binary Save is enabled by default only on the qualified environment:** Windows, local extension host, drive-letter `file:` on a fixed NTFS volume. The gate uses the CIM query shared with the image picker (`extension/src/localVolume.ts`). Everywhere else, Save keeps the reviewed-copy workflow. macOS and Linux are excluded because advisory locks cannot block other writers.
- The first in-place Save per opened file version requires a modal confirmation listing losses. Save As confirms only when content would be dropped. Save As never replaces an existing file, even after the dialog's own replace confirmation.
- After Save As, VS Code opens the new file in its default editor, because Folio editors are opt-in. This is accepted and documented.
- XLSX Save includes freshly calculated caches only when the webview has local calculation enabled. Otherwise stored results are kept and disclosed as possibly stale.
- PDF stays untagged. It is not claimed as tagged or PDF/UA.

## Decisions pending for the user

1. **Accept or reject in-place native Save as the release behavior** on the qualified Windows/NTFS environment. Folio did not declare reviewed-copy export equivalent to Save. The implementation is the conditional exclusive-lock write described above.
2. Whether native Save should be default-on (current) or behind an opt-in setting.
3. Whether unqualified platforms (macOS, Linux, Remote, other volumes) may ship with only the reviewed-copy workflow for DOCX/XLSX/CSV.
4. Tagged-PDF requirement: accept untagged PDFs with Lang, title and bookmarks for the first release, or fund replacing pdfmake with a structure-emitting generator.
5. Carried distribution decisions: the ELK/MELK source companion and object-code terms, and the pdfmake polyfill-version confirmation.

## Environment workarounds

- **Stuck VS Code update.** The installed VS Code at `%LOCALAPPDATA%\Programs\Microsoft VS Code` has a background update to `661626d0e72f97806550790a98fb87116c9db825` mid-install (`CodeSetup-stable-661626d0e7…` holds the `vscode-updating` mutex until the user's VS Code windows close). Every new instance of that install logs `checkInnoSetupMutex: vscode-updating is held` and exits, so the desktop harness fails at startup with “Target page, context or browser has been closed”. Folio's own processes were never killed. Restarting VS Code lets the update finish. The installed version will then be the new build, not 1.147.0.
- **Portable builds** (zip builds skip the installer mutex). They were downloaded into the session scratchpad, which may have been cleared. Re-download them into any folder:
  - VS Code 1.147.0 (commit `8a14f0cc1b08d531eb83255ea3764ae22aa932b5`, same as earlier qualification): `https://update.code.visualstudio.com/1.147.0/win32-x64-archive/stable`. Zip SHA-256 `42d65f18009959964d7cff8ca6f33149a195d52c08622821c8c681a08469c26e`.
  - VS Code 1.100.0 (commit `19e0f9e681ecb8e5c09d8784acaa601316ca4571`): `https://update.code.visualstudio.com/1.100.0/win32-x64-archive/stable`. Zip SHA-256 `6fa62a8f07a2b42993b19f81ed90c95a2de78299b7e227f226c76d87ceb06a9c`.
  - Both `Code.exe` files had valid Microsoft Authenticode signatures. Extract with `tar -xf <zip> -C <dir>`.
  - Point the harness at one: PowerShell `$env:FOLIO_VSCODE_EXECUTABLE = 'C:\path\to\vscode-1.147.0\Code.exe'`. For installed-VSIX runs also set `$env:FOLIO_VSCODE_CLI_JS` to that build's `resources\app\out\cli.js` (1.147.0 nests it under `8a14f0cc1b\resources\app\out\cli.js`) and `$env:FOLIO_TEST_VSIX = 'extension/dist/folio.vsix'`.
- VS Code 1.147 reports `context.globalStorageUri` as `vscode-userdata:`. `extension/src/binarySave.ts` maps it to the local profile path for save journals.
- Desktop tests that answer modal dialogs use the fixture option `customDialogs: true` (sets `window.dialogStyle: custom`), and the bridge command `startSave` with `saveOutcome`.

## Test commands

```powershell
npm run lint
npx tsc --noEmit
npx tsc --project extension/tsconfig.json
npm test
npm run test:e2e -- --workers=4 --output test-results/p10-chromium
npm run build
npm run build:extension
$env:FOLIO_VSCODE_EXECUTABLE = '<portable 1.147.0>\Code.exe'
npx playwright test --config playwright.vscode.config.ts --output test-results/p10-desktop-full
npx playwright test --config playwright.vscode.config.ts binarySave.vscode.ts multiformat.vscode.ts spreadsheet.vscode.ts --output test-results/p10-binary
npm run package:extension
```

Focused suites used so far: `npx vitest run src/host/vscode/verifiedReplace.test.ts`, `npx vitest run src/document/formats/spreadsheet`, `npx vitest run src/document/pdfExport/pdfExport.test.ts`, `npx playwright test tests/spreadsheet.e2e.ts`, `npx playwright test tests/docx.e2e.ts tests/editor.e2e.ts tests/split.e2e.ts tests/accessibility.e2e.ts`, `npx playwright test tests/pdfExport.e2e.ts tests/pdf.e2e.ts`. Run browser and desktop suites sequentially with distinct `--output` directories. The full Chromium suite and the full desktop suite have **not** yet been run on the final sources.
