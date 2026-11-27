# Phase 10 final integration

> **Phase 10.1 update.** The release blockers recorded here were worked in Phase 10.1 ([Phase 10.1 record](phase-10.1-release-qualification.md)). The PDF clipboard case passes on an interactive session. Native Save passed fault-injection qualification. XLSX passed independent openpyxl validation and the Excel 365 check. The source companion is verified, with hosting still unauthorized.

Phase 10 turns the Phase 9 multi-format editor into an integrated release candidate. It adds verified native Save for DOCX, XLSX and CSV on qualified Windows volumes, verified formula assistance and formula-aware structure edits, workbook themes, DOCX and Markdown table widths, PDF Unicode fallback and navigation metadata, pdf.js support for the minimum VS Code version, and the ELK source companion and notice corrections. **Folio is not yet ready for public release.** The remaining items are listed in [Remaining release blockers](#15-remaining-release-blockers). Nothing was published, pushed, merged or tagged.

[Project handoff](PROJECT_HANDOFF.md) · [Capability matrix](release-capabilities.md) · [Readiness](extension-readiness.md#phase-10-release-assessment) · [Qualification](extension-qualification.md#phase-10-qualification) · [Distribution](extension-distribution.md#phase-10-distribution-record)

## 1. Starting Git checkpoint

- Branch `phase-10-final-integration` in the original checkout, created from `origin/main` at `98cd8ed`. That commit is the PR #20 merge of Phase 9.1, VS Code appearance and Open with Folio. Its first parent is the Phase 9 merge `cd3474c` (PR #19), which contains the Phase 9 commit `e311c4d`. Branching from the latest merged `main` kept the merged Phase 9.1 work. Local `main` (`0de941b`) was stale and was not changed.
- The user's untracked `KNO3 DATA.xlsx` was never committed.

| Commit | Scope |
| --- | --- |
| `cdd229f` | Verified native Save and Save As for DOCX, XLSX and CSV on qualified Windows NTFS, save journal, content-based dirty state, binary status labels, bounded spreadsheet journal |
| `7f0ae0b` | Verified formula catalog (15 to 61 functions) and formula autocomplete |
| `67ed310` | IronCalc formula reference updates for row, column and sheet edits |
| `bc9ba3d` | DOCX column widths, keyboard width controls, Tiptap stale-width fix, Markdown table width persistence fix |
| `b98eedd` | PDF glyph fallback with code-point markers, language, title and outline |
| `7c2c5a0` | Workbook theme import and export |
| `10193a5` | Interim resumable checkpoint (superseded by this document) |
| `a518564` | Workbook theme dialog, theme swatches and accent styles |
| `e3475bc` | ELK source companion, EPL 2.0 and Unicode notices, pdfmake core-js version correction |
| `8ce9101` | Fix for a shared color choice that arrived before an editor subscribed |
| `db1429c` | pdf.js legacy build so PDF works on VS Code 1.100 |

## 2. Implemented improvements

- **Native binary Save** (section 3). This is the headline change for DOCX and XLSX in VS Code.
- **Spreadsheets.** Formula autocomplete, formula-aware row, column and sheet rename edits, workbook themes with theme swatches and accent styles, and a bounded improvement to the secondary journal (sections 4 and 5).
- **DOCX.** Column widths with pointer and keyboard resizing, fixed Word grids and reimport (section 6).
- **Markdown.** Resized tables can now be saved. Before Phase 10, DOMPurify removed `colwidth`, so a resized table made the draft unsaveable. Keyboard width controls were added (section 7).
- **PDF.** DejaVu Sans fallback, visible `[U+XXXX]` markers instead of blank glyphs, `/Lang`, `DisplayDocTitle`, nested bookmarks, and pdf.js's legacy build for older Chromium (section 8).
- **UX.** Status labels separate "Saved to file", "Unsaved · draft recoverable" and "Draft only · not saved to file". Save is native where qualified and otherwise explains the export alternative. A color choice now reaches a newly opened editor reliably (section 9).
- **Distribution.** Reproducible, hash-verified ELK source companion, EPL 2.0 and Unicode license texts, and corrected pdfmake component versions (section 14).

## 3. Native Save decision and evidence

The user approved in-place Save and Save As for DOCX and XLSX on qualified Windows/NTFS, on condition that tests prove the safety requirements. Save is enabled by default where qualified and disabled with an explanation elsewhere.

**Environment gate.** `extension/src/localVolume.ts` and `binarySave.ts` require all of the following. Anywhere else, Save keeps the draft and the editor says to use Export copy.

- a Windows local extension host (no `remoteName`)
- a `file:` URI with a drive letter and no authority
- a fixed (`DriveType=3`) NTFS volume, checked by CIM query
- save-journal storage on the local profile

**Conditional write** (`extension/src/verifiedReplace.ts`):

1. Reject links and non-regular files.
2. Open the file with libuv's `UV_FS_O_EXLOCK` (`0x10000000`), which on Windows is share mode 0, retrying briefly. While Folio holds the handle, no other process can open, write, delete, rename over or rename away the file. If another process already has it open, the open fails with `EBUSY` and Save reports "Another app has this file open".
3. Through that handle, check that the file is the one at the path (same file index) and that its SHA-256 equals the fingerprint Folio expects. A mismatch refuses Save and marks the document as externally changed.
4. Write a journal containing the previous and replacement bytes (stage, `fsync`, rename).
5. Write the replacement in place, truncate, `fsync`, and read back through the same handle to compare SHA-256.
6. On any failure after writing starts, write the previous bytes back through the same handle and verify them. If that is impossible, keep the journal and report it.
7. Close the handle, remove the journal, and confirm the path still names the same file.

Hashing before a separate write would only observe an earlier state. Here the check and the write happen under one lock that excludes every other writer.

**Interrupted saves.** On open, `classifyJournal` compares the file with the journal. If the file equals the replacement, the save completed. If it equals the previous bytes, the save never started. Both cases retire the journal. A mixture in which every byte matches the previous or the replacement file at that offset, with a length between the two, is a stopped Folio write. Folio reopens the last complete file as the original, the content being saved as an unsaved draft, and expects the mixed bytes on the next Save. Anything else is treated as an external change and the journal is kept.

**Losses and confirmation.** The first in-place Save of each opened file version shows a modal confirmation listing what the rewrite drops: Word layout and styles, import notes, XLSX warnings, stale formula results, CSV formatting and other sheets, or CSV quoting that does not round-trip. Save As writes only new files and asks only when content would be dropped. It never replaces an existing file, even after VS Code's own replace prompt. After Save As, VS Code opens the new file in its default editor, because Folio editors are opt-in.

**Recovery coherence.** Dirty state now follows content: whether the draft differs from what is on disk. Undo past a save point therefore keeps the recovery checkpoint. A failed save leaves the draft, the checkpoint and the original in place.

**Evidence**

- Nine Node tests in `src/host/vscode/verifiedReplace.test.ts`, run on real NTFS:
  - successful replacement keeps the same file identity
  - refusal of newer external content
  - missing and oversize files
  - a PowerShell process holding the file
  - external write, delete and rename-over attempts blocked between check and write
  - rollback on failed verification
  - a stopped write classified as interrupted
  - classification rules
  - damaged journals
- Five desktop cases in `tests/vscode/binarySave.vscode.ts`:
  - DOCX cancel, then confirm, then a second Save with no prompt
  - a file held open by another process
  - external replacement
  - Save As refusing an existing file and creating a new one
  - interrupted-save recovery from a real journal
  - XLSX Save, then Undo past the save point and Save again
  - CSV exact-byte literal Save
- All five desktop cases pass on the installed VSIX in VS Code 1.100.0, 1.147.0 and 1.148.0.

Not covered: disk-full and power-loss behavior during the write. A stopped write is simulated by closing the handle, and power loss is covered by the journal's byte-mixture rule. Other Windows volume types, macOS, Linux and Remote are not covered, and they use the reviewed-copy workflow.

## 4. Recovery and conflict behavior

- Native Save refuses known external changes before any prompt, files held by other apps, identity changes, and unqualified environments. The draft and recovery checkpoint are kept in each case.
- The spreadsheet webview journal still stores whole drafts up to 2 MiB. Above that, it stores the pending splice with a whole-base FNV-1a checksum, the replaced text and 64 characters of context on each side. A restore applies only to the same host-acknowledged base, and the restored workbook must still parse. When no copy can be stored, the status reads "Syncing · not yet recoverable" rather than implying recovery. The native host checkpoint stays authoritative.
- Content-based dirty state keeps the host checkpoint whenever the draft differs from disk, including after Undo past a save.
- All existing recovery cases pass in the final full desktop run: DOCX hot exit, acknowledged-draft recovery after an extension-host stop, pending-transaction restore, CSV hot exit with replaced bytes, and TXT and Markdown recovery channels.

## 5. Spreadsheet completion

- **Formula catalog.** It now has 61 functions. Each is evaluated through Folio's worker admission and IronCalc 0.9.1 with a pinned result in `formulaCatalog.test.ts`. Date functions are unsupported in 1904 workbooks because IronCalc evaluates them in the 1900 system. `INDIRECT`, `OFFSET`, `XLOOKUP` and the locale-dependent `VALUE` are not admitted.
- **Autocomplete.** In the formula bar and the cell editor, suggestions appear after `=` and filter as you type, with descriptions, syntax, the active argument of the innermost call, and a warning naming functions outside the list. Arrow keys move, Tab or Enter inserts, and Esc closes. Suggestions come only from the local catalog. The fields keep the textbox role with `aria-autocomplete`, `aria-controls` and `aria-activedescendant`.
- **Formula-aware structure edits.** Row and column insert and delete, and sheet rename, run in IronCalc. Folio writes back only the reference tokens IronCalc changed, aligned token by token, so spacing, case and literals are preserved. Removed references become `#REF!`. `INDIRECT`, `OFFSET`, external and structured references, and unparseable text refuse with an explanation. Sheet delete keeps the guarded rewrite, because IronCalc 0.9.1 leaves references to a deleted sheet unchanged. Reorder changes no references. IronCalc's `moveSheet` is not used because it broke the model in a probe. Tests cover relative, absolute, mixed, range and cross-sheet references, `#REF!`, refusals, Undo and an XLSX round trip.
- **Themes.** `Workbook.theme` is read with IronCalc's `getTheme` and written with `setTheme` into `xl/theme/theme1.xml`. The built-in list is tested equal to `getThemeList()`. The Workbook theme dialog, theme swatches in the font and fill pickers, and theme accent styles are new. Cell colors stay stored as RGB and do not recolor when the theme changes, and the dialog says so. Import warns only when the original theme has its own font scheme, which IronCalc rewrites.
- **Toolbar.** The existing toolbar controls passed the full spreadsheet browser and desktop suites. The fixed Forest, Slate and Sand palettes were replaced by theme accent styles. A full manual pass on every toolbar control in both themes was not done.
- **CSV.** VS Code's text editor remains the default for CSV everywhere, so native `TextDocument` Save keeps the exact text on every host. The Folio grid editor saves in place on qualified Windows. It writes literal values in the original dialect, and its confirmation discloses when the file's quoting does not round-trip. Elsewhere it offers reviewed copies. A text-backed grid that splices only edited records into the native buffer was evaluated and not built (section 15).

## 6. DOCX editing improvements

- Cells carry whole-pixel column widths in the range 24–2000 px. Each column has one width, and rows added later inherit it.
- The writer emits `w:gridCol` and `w:tcW` in twips (1 px = 15 twips exactly). A fully sized table gets `w:tblW` as a dxa value and `w:tblLayout w:type="fixed"` in schema order. Columns without a width stay automatic.
- The reader keeps Word's grid widths instead of reporting them as approximated. Folio's own geometry reimports with no table-formatting note.
- Pointer resizing is enabled. Table controls add Widen column, Narrow column (±24 px) and Reset column width, each one undoable transaction, for keyboard use.
- Tiptap 3.35's column update left a stale `width` style when a column returned to automatic width. `FolioTableView` clears it.
- Merged, nested and other complex tables are still refused at import. Rectangular structure is preserved.
- Word 365 (16.0.20625) opened a Folio DOCX read-only. The table measured 180 pt and 72 pt for 240 px and 96 px columns, with fixed layout (`AllowAutoFit=False`). The Heading 1 style, the Unicode text and the hyperlink were intact.

## 7. Markdown advanced editing qualification

- **Tables.** Pointer and keyboard width changes now persist, then serialize as an HTML table with `colwidth` and reopen after reload (browser test). Insert, rows, columns, merge and split were unchanged and covered by the existing suites.
- **Visual, Source and Split; images; Mermaid; navigation.** Covered by the unchanged standalone suites (101 passed) and desktop suites (picker, native Save, recovery, Mermaid and ELK rendering). No new Markdown image or Mermaid features were added in Phase 10.

## 8. PDF Unicode and accessibility work

- **Glyphs.** The fallback order is Roboto, then DejaVu Sans, then DejaVu Sans Mono. Code tries the mono face first. Uncovered characters, such as CJK and emoji, print as `[U+4E2D U+6587]` markers that can be searched and extracted. Joiners and variation selectors stay with their sequence. The review states the substitution, and validation compares the printed text.
- **Verified scripts.** Accented and extended Latin, polytonic Greek, Cyrillic, Armenian, Georgian, and symbols (`∑ ∞ ≤ ≥ ≠ ✓ ★ € £ ¥ №`) render and extract. This was checked with pdf.js and pypdf.
- **Metadata.** `/Lang` comes from Markdown `lang:` front matter or the reader's locale, and is validated as BCP 47. `DisplayDocTitle` is set, and headings become nested bookmarks. pypdf 7.1.1 (strict) read `Lang en-US`, `DisplayDocTitle true`, the title and the nested outline. It found no `MarkInfo` or `StructTreeRoot`.
- **Untagged by decision.** Exported PDFs are untagged: pdfmake 0.3.14 emits no structure tree, and Folio does not set the tagged flag. The user accepted untagged PDFs for 1.0. Exported PDFs are **not** claimed to meet PDF/UA or to suit accessibility-regulated workflows. Tagged output would need a generator that emits structure elements (for example pdfkit's structure API directly). That is a post-release item.
- **pdf.js legacy build.** VS Code 1.100 runs Chromium 132, which lacks APIs the modern pdf.js 6.5 build requires (`Math.sumPrecise`, `getOrInsertComputed`, `Uint8Array.fromBase64`, `Float16Array`). Every PDF opened there as "not a readable PDF document". Folio now loads pdf.js's own legacy build and worker, which include core-js 3.51.0 polyfills, at about 6% more size (viewer chunk 500 KB, worker 1.24 MB).
- **Readers.** pdf.js validation passed on every export. pypdf 7.1.1 strict passed. The built-in Windows PDF engine (`Windows.Data.Pdf`) loaded and rendered a page at 816×1056 DIPs (US Letter).

## 9. Cross-format UX changes

- DOCX and spreadsheet status labels: "Saved to file", "Unsaved · draft recoverable", "Draft only · not saved to file" and "Syncing · not yet recoverable". No draft is labeled "Saved".
- Save in the File menu and the spreadsheet header is native where qualified. Elsewhere the DOCX menu keeps Export DOCX copy…, and the spreadsheet button reads "Draft status" and explains the export alternative.
- A theme or accent chosen in one Folio editor reaches a newly opened editor even when the choice arrives before the editor subscribes (`8ce9101`). This was found as a full-run flake.

## 10. Security and performance findings

- **Security.** No new network access, CSP relaxation or workspace write surface outside the native Save gate. Native Save writes only the file the user opened, under an exclusive lock with a fingerprint check. Save As uses the existing exclusive-create publisher. The save journal lives in VS Code's profile global storage and contains document content, with the same sensitivity as the existing backups. Automatic image uploads remain disabled. Formula autocomplete is local.
- **Performance.** The 5 MB Markdown Source benchmark was paired against a Phase 9.1 (`98cd8ed`) bundle built in this checkout, in four alternating runs on portable VS Code 1.147.0:
  - Typing p95 medians: 82.6 ms (Phase 10) and 82.8 ms (baseline).
  - Checkpoint creation p95: 50.6–60.6 ms, against 49.8–54.9 ms.
  - Acknowledgement p95: 169–451 ms, against 144–283 ms.
  - Startup: about 3.2–3.4 s.
  - Source switch: about 1 s or about 2 s in **both** bundles. Phase 10 hit the 2 s mode in 3 of 4 runs, the baseline in 1 of 4. This is not established as a regression, but it is flagged.
  - All values are under the existing thresholds (110 ms, 75 ms, 2 s, 8 s and 4 s).
  - The machine-level typing p95 (about 80 ms) is higher than Milestone 2.7's 51 ms for both bundles.
  - The retention benchmark was not rerun.
  - The lazy PDF export chunk grew from 2.09 MB to 3.11 MB with DejaVu Sans. Markdown startup does not load it.
  - The standalone CSV benchmark ran inside the Chromium suite.

## 11. Test commands and results

Environment: Windows 11 Pro 25H2 x64 (10.0.26200.9974), fixed NTFS `C:`, Node 24.13.0, npm 11.21.0, Playwright 1.65.1, Chromium build 1255.

| Command | Result on final sources (`db1429c`) |
| --- | --- |
| `npm run lint` | Passed, zero warnings |
| `npx tsc --noEmit` and `npx tsc --project extension/tsconfig.json` | Both passed |
| `npm test` | 313 passed in 36 files |
| `npm run build` | Passed with the existing chunk-size warnings |
| `npm run test:e2e -- --workers=4 --output test-results/p10-final2-chromium` | **101 passed**, one uninterrupted run (95 Phase 9 cases plus 6 new) |
| `npm run build:extension`, then `npx playwright test --config playwright.vscode.config.ts --output test-results/p10-final2-desktop` with `FOLIO_VSCODE_EXECUTABLE` set to portable 1.147.0 | **81 passed, 1 failed** of 82 in one uninterrupted run. The failure is `PDF opens only through the opt-in viewer…` at its clipboard read-back. See below. |
| `npm run package:extension` | `extension/dist/folio.vsix`, 205 entries, 8,814,394 bytes, SHA-256 `aa1f09b71d4628573a83a94349f4ee59a9f038cd5a114a24af14a8058bf3d1c3` |
| Installed VSIX, `FOLIO_TEST_VSIX=extension/dist/folio.vsix` with the subset in [qualification](extension-qualification.md#phase-10-qualification) | **26 passed, 1 failed** of 27 on each of VS Code 1.100.0, 1.147.0 and 1.148.0. The same clipboard case failed each time. |
| `npm run source:companion` | All seven pinned SHA-256 values and the elkjs lockfile integrity verified. The archive records ELK chunk `52ee6432…93b3aa4d`, matching the VSIX. |

**Clipboard failure.** The Windows session running these tests refused clipboard access to every process. PowerShell `Set-Clipboard` and WinForms `Clipboard.SetText` both failed with "Requested Clipboard operation did not succeed". `query user` showed the console session idle for over six days, consistent with a locked workstation. VS Code's `env.clipboard.writeText` followed by `readText` returned an empty string in a separate probe. This test case passed in Phase 8 and 9 and has no Phase 10 code changes. Rerun it, and the Excel reader check, on an unlocked interactive session before release.

**Build reproducibility.** The repository uses `core.autocrlf=true`. Vite's output, including chunk names, depends on the working copy's line endings. Checking out `98cd8ed` in place to build the benchmark baseline rewrote the changed files as CRLF, and the next build renamed most webview chunks. The final artifact was rebuilt from the uniformly CRLF Windows working copy, and all of the final desktop, installed and inventory evidence above refers to that artifact (`aa1f09b7…`). Build release artifacts from a fresh checkout and record their hashes. Do not assume a byte match with a checkout that has different line endings.

Development-time failures resolved during Phase 10:

- The installed VS Code update blocked new instances (use the portable builds).
- `globalStorageUri` uses the `vscode-userdata:` scheme.
- The simple dialog asks inside the quick input.
- Two packages shared their first 256 bytes, which affected the interrupted-save fixture.
- The shared-color race (fixed in `8ce9101`).
- The pdf.js modern build failed on 1.100 (fixed in `db1429c`).

## 12. Independent-reader results

| Reader | Result |
| --- | --- |
| Microsoft Word 365 16.0.20625 (automation, read-only, macros force-disabled for the session) | Folio DOCX opened. Heading 1 style, Unicode text, hyperlink and 2×2 table at 180 pt and 72 pt with fixed layout. |
| Microsoft Excel 365 16.0.20625 | **Not completed.** In this locked session, Excel automation could create a workbook but every opened workbook, including one Excel itself had saved, returned no worksheets (`0x800AC472`, Excel busy). Folio's own tests verify the theme, formulas and caches by IronCalc reimport. Phase 9's Excel check of earlier copies still stands. Rerun on an interactive session. |
| pypdf 7.1.1, strict | Folio PDF parsed. Lang, title, DisplayDocTitle, nested outline and all script samples and markers extracted. Untagged, as disclosed. |
| Windows.Data.Pdf | Loaded and rendered at US Letter. |
| Python `csv` | Native-saved CSV parsed to the exact values, including leading zeros, literal `=SUM(1,2)` and an embedded CRLF. |
| LibreOffice | Not installed. Not qualified. |

## 13. Tested host and platform matrix

| Environment | Coverage |
| --- | --- |
| Windows 11 Pro 25H2 x64, fixed NTFS, local `file:` | Full desktop suite on portable VS Code 1.147.0 (`8a14f0cc1b`). Installed VSIX on 1.100.0 (`19e0f9e6`, Electron 34.5.1, Chromium 132), 1.147.0 and 1.148.0 (`661626d0e7`). Native Save is qualified here only. |
| Restricted Mode, virtual provider (synthetic `folio-test-remote:`) | Folio is disabled or declined, and the native editor is available (desktop suite). |
| macOS, Linux, WSL, Remote SSH, Dev Containers, other Windows volume types | **Not available and not tested.** Unqualified. Native Save is disabled there by the gate, and the reviewed-copy workflows apply. No support is claimed. |

## 14. Final dependency and distribution assessment

- **ELK/MELK.** The elkjs 0.12.1 recipe compiles the pinned ELK commit's Java, Xtend and `.melk` sources with GWT. The snapshot MELK generator (`0.13.0-SNAPSHOT`) is a build tool that is not distributed, and both its inputs and its own source are in the ELK commit. It affects byte-exact rebuilds, not source availability, and EPL 2.0 does not require reproducibility. `npm run source:companion` builds a hash-verified corresponding-source archive containing the elkjs and ELK commits, the EMF GWT, Xtext Xbase, Guava GWT and GWT source JARs, the npm package, the build steps, the licenses, Folio's lockfile and build configuration, and the packaged chunk hash. The VSIX now carries the EPL 2.0 text (byte-identical to elkjs's own `LICENSE.md`) and the Unicode License V3 for the CLDR data in GWT's i18n runtime. The GWT and Guava source JARs carry no Apache NOTICE files. **Remaining:** host the archive at a durable public URL beside the release and record the URL in `THIRD_PARTY_NOTICES.md`. This is part of the publication step and needs the user's authorization. Obtain any legal review the user requires of the object-code terms.
- **pdfmake.** pdfmake 0.3.14 publishes no lockfile for its build polyfills. The shipped bundle embeds **core-js 3.51.0**, not the 3.49.0 previously listed, which is now corrected. Its license matches the integrity-verified 3.51.0 package. buffer 6.0.3, process 0.11.10, file-saver 2.0.5, ieee754 1.2.1 and base64-js 1.5.1 are the only published versions in pdfmake's declared ranges. events 3.3.0 is the latest 3.x. pdfkit and its runtime dependencies match Folio's lockfile. SVG-to-PDFKit is pinned to the upstream commit pdfmake declares. **Resolved.**
- **pdf.js legacy build.** It embeds core-js 3.51.0. The PDF notice now records it.
- **IronCalc.** Both bindings are pinned at 0.9.1. The packaged `spreadsheet.wasm` (SHA-256 `03235ab1…3cc196c`) is byte-identical to the npm WASM. The MIT option and the Rust crate and Unicode CLDR notices are unchanged. Execution needs no network resources.
- **DOCX.** The `fflate`, `saxes` and `xmlchars` notices are unchanged.
- **Artifact inspection.** No files outside the allowlist. Byte-equal to the build. `EPL-1.0.txt` and `EPL-2.0.txt` are marked `-text` in `.gitattributes`, so they check out and package byte-exact. `EPL-2.0.txt` equals elkjs's `LICENSE.md`. No source maps, development files or CDN URLs. All four notice files are present and match their sources. One credential-pattern match was a false positive inside the inline base64 IronCalc WASM.

## 15. Remaining release blockers

1. **Publication step (user authorization required).** Host the ELK source companion at a durable public URL, record it in the notices, rebuild and recheck the exact release artifact and checksums, and authorize the channel. Public GitHub, releases, Open VSX and the Marketplace stay blocked until then.
2. **Clean desktop and Excel reruns on an interactive session.** Rerun the PDF clipboard case and the Excel 365 reader check on an unlocked desktop.
3. **Platform claims.** The first release may claim only Windows with the qualified scope unless macOS, Linux and Remote are independently qualified with the VSIX. The release notes and Marketplace text must state this.
4. **Not blockers, tracked for after 1.0:**
   - tagged PDF (accepted as untagged)
   - a text-backed Folio CSV grid (VS Code's text editor already provides native CSV Save)
   - LibreOffice interoperability (not available here)
   - a full manual toolbar pass in high contrast with a screen reader
   - the bimodal Source switch time
   - native Save on non-NTFS or non-Windows volumes (reviewed copies apply)

## 16. Exact final artifact and checksums

- `extension/dist/folio.vsix`: `smithja06.folio-markdown-editor@0.1.0`, 205 entries, 8,814,394 bytes, SHA-256 `aa1f09b71d4628573a83a94349f4ee59a9f038cd5a114a24af14a8058bf3d1c3`, built from the Phase 10 documentation commit, whose code is identical to `db1429c`.
- Key members:
  - `dist/extension.cjs` `e791ea21…2b08d38`
  - `dist/docx-codec.cjs` `a685a422…fcae03d`
  - `dist/spreadsheet-codec.cjs` `9c65325e…d963ef4`
  - `dist/spreadsheet.wasm` `03235ab1…3cc196c`
  - ELK chunk `elk-XV6XMXQE-LmPXhOG2.js` `52ee6432…93b3aa4d`
  - PDF export chunk `browser-CS2Wys0c.js` `60fc5b3c…69316e97`
  - pdf.js viewer `pdf-rELvHkft.js` `279139fd…f989af`
  - pdf.js worker `pdfjsWorker-_rVGiUi4.js` `0e54483e…4ccab64`
- `extension/dist/source-companion/folio-elk-source-companion.zip`: 22,222,075 bytes, SHA-256 `6b593b2a40899cd6753dd9dfd03178b46ca678a058d927db90b7436c9ec82469`. Local only, not packaged or published.

## 17. Recommended next steps

1. On an unlocked desktop, rerun `npx playwright test --config playwright.vscode.config.ts pdf.vscode.ts -g "PDF opens only"` and the Excel read-only check of a native-saved XLSX (`test-results/readers`).
2. If the user authorizes publication, host the source companion, record its URL, repackage, re-inventory and run the installed smoke tests, then publish only to the authorized channel.
3. Decide the platform claim (Windows-only, or qualify macOS, Linux and Remote with the runbooks in [qualification](extension-qualification.md)).
4. After 1.0: tagged PDF, a text-backed CSV grid, LibreOffice checks, and the Source switch investigation.

## 18. Next Chat Starter

> Continue Folio in the original checkout `C:\Users\xxjad\OneDrive\Desktop\Personal VSCode\universal-markdown-editor-extension` on branch `phase-10-final-integration` (final commit is the Phase 10 docs commit on top of `db1429c`, base `origin/main` `98cd8ed`). Read `docs/phase-10-final-integration.md`, `docs/PROJECT_HANDOFF.md` and `docs/release-capabilities.md`. Keep the user's untracked `KNO3 DATA.xlsx` uncommitted. The user's decisions:
>
> - Native in-place Save is approved only where tests prove safety, and is on by default there.
> - Reviewed-copy-only workflows are acceptable on unqualified platforms, and no unqualified platform may be claimed.
> - Native CSV text Save stays.
> - Untagged PDF is accepted, with no PDF/UA claim.
> - Third-party obligations must be met before any release.
> - Publication, pushing, merging and visibility changes require explicit authorization.
>
> Remaining work:
>
> 1. On an unlocked interactive Windows session (the last run's session refused all clipboard access), rerun the PDF clipboard desktop case and an Excel 365 read-only check of a native-saved XLSX. The installed VS Code may hold a background-update mutex. The portable zip builds avoid it: `https://update.code.visualstudio.com/1.147.0/win32-x64-archive/stable` and `…/1.100.0/…`, via `FOLIO_VSCODE_EXECUTABLE`, plus `FOLIO_VSCODE_CLI_JS` and `FOLIO_TEST_VSIX` for installed runs.
> 2. If the user authorizes release, host `npm run source:companion`'s archive at a durable URL, record it in `extension/THIRD_PARTY_NOTICES.md`, repackage, re-inventory and run the installed smoke tests.
> 3. Only if asked, qualify macOS, Linux or Remote with the runbooks, or implement a text-backed CSV grid or tagged PDF.
>
> Do not push, merge, tag or publish without explicit authorization.
