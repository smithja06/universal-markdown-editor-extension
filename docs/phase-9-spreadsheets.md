# Phase 9 spreadsheets

Folio opens XLSX workbooks and CSV tables in standalone and through the optional spreadsheet editors in VS Code. The shared editor follows the supplied photo’s order. A compact workbook header sits above grouped spreadsheet tools, the name box and formula bar, a full-width grid, and a docked sheet bar with regional settings. It uses Folio’s controls, theme tokens and local document workflows.

## Shared model and lifecycle

The workspace holds sparse cell records keyed by A1 address and sheets identified by stable IDs. The workbook tracks sheet order, dimensions, hidden and frozen axes, merges, grid lines, conditional rules, locale, timezone and the 1900 or 1904 date system. A cell holds its typed value or expression, optional cached result, style and validated link. The grid renders the viewport and a small area around it. It retains the name box, formula bar and headers while scrolling.

Standalone workbook drafts use the existing IndexedDB library, automatic checkpoints, manual versions, conflict checks and Trash. Imports store the original bytes and the decoded draft transactionally. Download original returns the original format and bytes. Save draft checkpoints the editable copy in the library. XLSX, CSV and PNG exports capture the workbook revision, generate a copy, then verify that the captured revision is still current before downloading.

VS Code registers optional XLSX and CSV custom document providers. CSV continues to open in VS Code’s text editor by default. The Folio providers hold authoritative workbook state in the extension host. The host validates bounded changes, applies them against the current revision and checkpoints them before acknowledgment. The native Undo/Redo stack tracks transactions. Backups include the opened source bytes and workbook draft for hot exit. Revert loads the latest on-disk version. On a file change or deletion, Folio retains the opened workbook and draft and reports the conflict. In-place Save and Save As remain open pending conditional replacement and recovery qualification. The save dialog publishes copies to new local files using exclusive creation and readback. The extension uses the workbook UI in trusted workspaces and restricts its file workflow to supported local file URIs.

## IronCalc and formula evaluation

Both IronCalc npm bindings are pinned at 0.9.1. Folio uses the XLSX-capable binding for workbook IO and formulas. The native worker reads the bundled WASM from disk. The browser and VS Code webview load an inline worker with local WASM bytes. XLSX work is lazy and the native webview enables WASM compilation only for spreadsheet editors. The build includes the IronCalc and dependency notices. [IronCalc source](https://github.com/ironcalc/IronCalc) · [IronCalc documentation](https://docs.ironcalc.com/) · [Spreadsheet notices](../public/SPREADSHEET_THIRD_PARTY_NOTICES.txt)

The codec preflights workbook ZIP entries and XML, rejects executable workbook content, and excludes active connections and unsupported parts from the package provided to IronCalc. It retains imported formula text and recognized cached results as data. Folio calculation is explicitly enabled for imported workbooks. A versioned catalog defines the admitted functions and the editor’s reference panel. The worker validates function tokens, reference areas, formula count and dependency depth before evaluation. Cycles and unsupported dependencies yield a visible unsupported result. The worker terminates on cancellation or timeout. The worker receives embedded or packaged bytes and requires no network resources. Macro execution, external data fetches and full Excel formula compatibility remain outside the supported scope.

An XLSX copy retains formulas even where the Folio evaluator lacks support. If the reviewed draft has current local calculation results, the export worker recomputes verified caches for supported formulas for that copy. Other formulas retain their available stored results. Folio writes XLSX copies in manual calculation mode. The export review describes the cache behavior.

## XLSX fidelity

| Feature | Supported in the copy | Boundary |
| --- | --- | --- |
| Worksheets | Names, order, ordinary worksheets and editable sheet metadata | Chart tabs and hidden sheet state are reported when omitted or approximated. |
| Values and formulas | Strings, numbers, booleans, supported errors and dates, formula expressions and stored caches | Unsupported formula structures may be reduced to expression and cache, with a review. Cached results can be stale. |
| Visual formatting | Supported fonts, text styling, font and fill colors, alignment, wrap, borders and number/date formats | Theme-based colors resolve to supported colors. Advanced formatting, print layout and original theme identifiers can differ. |
| Geometry | Supported row heights and column widths, merges, hidden/frozen axes and grid-line setting | Default dimensions can be approximated. Excel and Folio map absolute dimensions to different units. Export rejects merges with hidden values to avoid discarding content. |
| Conditional formatting | Supported comparisons, text contains, duplicates, two-color scales and data bars | Only supported ranges, thresholds and visual attributes are carried. Unsupported rule types and metadata are reviewed at import and export. |
| Links and workbook features | Supported cell links use HTTPS, HTTP or mailto. XLSX date system, supported core properties and Folio locale/timezone metadata are retained. | Macros and executables are rejected. Connections, chart and pivot content, structured table metadata, defined names and unsupported properties are disclosed and omitted. |

## CSV dialect and export

CSV import reads UTF-8 with an optional BOM and detects comma, semicolon, tab and pipe separators. It understands quoting, doubled quotes, embedded newlines, blank cells and trailing fields. Cells are literal text, including long identifiers, leading zeros and formula-like input. The parser tracks record endings and reports normalization of mixed endings in copies. A header-row choice affects the draft view. Both hosts can reread the original with a corrected delimiter before making cell edits.

CSV exports require a sheet and a choice between literal and spreadsheet-safe text. The safe option prefixes risky formula-like text with an apostrophe. CSV copies contain one sheet and omit styles, workbook structures and workbook metadata. Unmodified bytes remain available through Download original.

## Resource boundaries

- File IO is limited to 16 MiB. XLSX ZIP and XML processing applies additional limits for entry count, expanded size, depth and structure. A workbook can have up to 64 sheets and 150,000 populated or formatted cells. CSV parsing and export count fields, including empty fields, against 150,000.
- Grid and formatting operations limit the number of cells in a transaction. Formula evaluation bounds formulas, tokens, reference areas and dependency depth. Several concurrent spreadsheet workers can run across open documents with limits per host.
- PNG uses the shared range layout and paints displayed cells with supported fills, fonts, alignment, borders, conditional styles, and merged spans. It exports the rectangle without the application chrome. Pixel limits apply before allocation.

On Windows with Node 24.13.0, a synthetic engine probe used three sheets of 450 rows by 65 columns each, for 87,750 populated cells, 17,280 styled cells, 1,350 formulas and three conditional rules. The XLSX copy was 518,200 bytes. Export took 1,285 ms, reimport 1,251 ms and calculation 1,125 ms. The process lifetime reached 644,188 KiB peak RSS. These times exclude worker startup overhead, workbook transfer and browser painting.

Standalone Chromium with a 1440 × 900 viewport opened a 1,639,151-byte CSV with 12,000 rows, eight fields per row and 96,000 fields in 1,387 ms. Jumping to H12000 took 144 ms and the rendered grid had 465 cells. A separate sample pasted 12,000 cells in 129 ms measured through the first visible result. The paste was one undoable transaction.

## Independent readers and remaining scope

Excel 16.0 build 20625 on Windows opened a browser-generated copy read-only, retained the sheet and formula, and manually recalculated the expected result. A separate Node-worker-generated copy opened in the same Excel version and preserved two sheets, a padded identifier, a number and Boolean, a formula, 1904 date serials, font/color and number date styles, a merge and a numeric conditional rule. Excel displayed approximate geometry in its own width and height units. External-link updating and macros were disabled for these probes. LibreOffice was unavailable in this environment.

Folio preserves values through supported style and regional changes. **Phase 10 update:** workbook themes, verified formula autocomplete, IronCalc reference updates for row and column insert and delete and sheet rename, and native in-place Save on qualified Windows NTFS are implemented ([Phase 10 record](phase-10-final-integration.md#5-spreadsheet-completion)). A text-backed Folio CSV grid remains open, and VS Code's text editor still provides native CSV Save. References Folio cannot update, such as INDIRECT, OFFSET, external and structured references, keep structure edits unavailable with an explanation. Folio’s visible frozen panes are limited to 80 rows and columns. The header and formula bar expose full cell inputs when the grid clips text. The native secondary webview journal stores whole drafts up to 2 MiB and, since Phase 10, a checksum-verified splice for larger drafts. The status says when a pending change has no webview copy. The extension persists acknowledged edits and keeps the open spreadsheet session while its tab is hidden.

## Verification

| Command or check | Recorded result |
| --- | --- |
| npm run lint | Passed with zero warnings. |
| npx tsc --noEmit and npx tsc --project extension/tsconfig.json | Both passed. |
| npm test | 277 passed in 31 files. |
| npm run build and npm run package:extension | Both passed. The latter ran the extension build and created the local VSIX. |
| npx playwright test --config test-results/playwright.production.config.ts --workers=3 --reporter=list --output test-results/phase9-qualified-browser | 95 passed, including 13 spreadsheet cases. The generated config used the repository Playwright settings and a Vite production preview on port 4174. |
| npm run test:e2e -- --workers=3 --reporter=list --output test-results/phase9-final-browser | 95 passed on the final sources using the standard standalone runner. |
| npx playwright test --config playwright.vscode.config.ts --output test-results/phase9-desktop-full | Initial development run had 70 passes and four failures. Three legacy failures passed in a final-bundle retry. The new XLSX case was rerun on the final installed VSIX after fixing replacement trust. |
| npx playwright test --config playwright.vscode.config.ts multiformat.vscode.ts -g 'unqualified Save As\|DOCX preserves a pending transaction\|DOCX recovers an acknowledged draft' --output test-results/phase9-qualified-desktop-retries | Three passed. All 68 legacy desktop cases passed across the full run and retries. |
| npx playwright test --config playwright.vscode.config.ts spreadsheet.vscode.ts --output test-results/phase9-final-installed | Eight passed with the final VSIX installed into isolated profiles using the local VS Code 1.147.0 CLI. |
| Archive inventory, exact WASM and notices, production startup network probe | Passed. [Distribution record](extension-distribution.md#phase-9-spreadsheet-runtime) |

The standalone suite checked the existing Markdown, TXT, DOCX and PDF flows, plus spreadsheet draft recovery, quota rollback, formula and formatting edits, history across tabs, CSV multiline data and safe output, range PNG and large-grid behavior.

## Next Chat Starter

Continue Folio in Phase 10 from the verified merge of Phase 9 into origin/main. Check the local and remote history, preserve the original checkout and create a separate Phase 10 branch from the merge. Read this document, the [handoff](PROJECT_HANDOFF.md), [capability matrix](release-capabilities.md), [qualification](extension-qualification.md) and [distribution record](extension-distribution.md). Qualify independent spreadsheet readers and remaining CSP, provider and platform combinations. Address outstanding XLSX and DOCX native write decisions, DOCX table widths and resizing, image and table parity and asset management, PDF missing-glyph and accessibility requirements, and the ELK/MELK and pdfmake distribution requirements. Preserve local draft and original-byte workflows and reference-only workspace images. Record test and package evidence against the exact release artifact and keep public distribution pending explicit authorization.
