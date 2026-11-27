# Folio 0.1.0 personal acceptance checklist

Use synthetic files only. Do not use personal workbooks or documents. About 30–45 minutes for a full pass.

## Install

1. Use your normal desktop VS Code 1.148 on Windows. Folio adds editors only through **Open with Folio**, so your defaults do not change. To keep your normal profile untouched, create a profile first: **Profiles: New Profile…**, named for example "Folio test", and switch to it.
2. Install the candidate. Use the **Extensions: Install from VSIX…** command and pick the file, or run:
   ```powershell
   code --install-extension "C:\Users\xxjad\OneDrive\Desktop\Personal VSCode\universal-markdown-editor-extension\extension\dist\folio.vsix"
   ```
   Check the SHA-256 in `docs/phase-10.1-release-qualification.md` first: `Get-FileHash <path> -Algorithm SHA256`. Installing a newer candidate over an older one replaces it. Reload open VS Code windows afterwards.
3. Make a test folder on `C:` outside OneDrive, for example `C:\FolioTest`. Open it with **File → Open Folder** and trust it.
4. Copy the demo files into it:
   - Run `npm run interop:xlsx` in the repository. Copy `test-results\interop\xlsx\folio-features.xlsx` and `folio-structure.xlsx`.
   - Create `notes.md`, `plain.txt` and `inventory.csv` yourself with a few lines each.
   - Make a DOCX in Word with a heading, a bulleted list and a 3×3 table.
   - Use any PDF Folio exports in the PDF step.

Uninstall afterwards with `code --uninstall-extension smithja06.folio-markdown-editor`, or delete the test profile.

## Round 1 (November 27, 2026, VSIX `e44a231b…`)

All the items below passed except the noted ones. Both result boxes were ticked, with "view notes". Issues were found, so round 1 did not accept the release.

| Area | Owner's note | Cause and fix |
| --- | --- | --- |
| TXT | Only **Replace all** works, not **Replace**. | The Markdown, TXT, DOCX and PDF webviews blocked form submit events, and **Replace** is a submit button. Forms are now allowed. The page's security policy (`form-action 'none'`) still blocks any real submission. This also fixes Enter in the PDF page box, the Export TXT copy dialog, workbook rename and Properties custom fields. |
| DOCX | Italic doesn't show a change in the editor, but Word shows it. | Only Inter's upright face was bundled, and `font-synthesis: none` stopped the browser slanting the text itself. Inter's italic face is now bundled, also in exported copies, and slant synthesis is allowed for heading fonts with no italic. This affected Markdown too. |
| XLSX | Ctrl+B doesn't bold. The bold button works. | From a selected cell, the key also reached VS Code, which toggled the side bar. Inside the cell editor or formula bar it was ignored. Ctrl+B, Ctrl+I and Ctrl+U now format the selected cells from the grid, the cell editor and the formula bar, and VS Code no longer sees them. A cell holds one style, so selected text formats the whole cell. |
| XLSX | `=SUM(1,2,3)` and `=SUM(C2, C3)` show an em dash with no result. The row insert item was left unticked. | Folio opens an existing workbook with stored results, and calculation is off until you enable it. A new or changed formula had no stored result, so it showed "—". Typing a formula now turns on calculation for that workbook, with a notice. A formula with no result shows **Not calculated**, and a banner offers **Enable calculation**, or **Recalculate** after a calculation error. During a recalculation, unchanged formulas keep their last value and new ones show **Calculating…**. |
| Recovery | The edit is back after restart but cannot be undone. | That item's wording was wrong. After a restart VS Code keeps no undo history for any editor, including text files. The restored draft is the starting point: later edits can be undone, and **File: Revert File** discards the draft. The wording is corrected below. |
| Appearance | Dark mode is dark green. It should match VS Code's dark mode, with only the accent color changeable. | Folio Dark now uses neutral greys close to VS Code Dark Modern. The accent picker supplies the only color. **Match VS Code** still uses the workbench colors exactly. |
| Markdown | (Seen in this file's diff) | Saving this checklist from Folio added `<!--folio:boundary-->` between almost every block and blank lines between list items. Folio now adds a separator only where two blocks would otherwise merge, such as adjacent lists, and writes new or rewritten lists tight unless an item holds several paragraphs. |

## Round 2 re-test

Install the round 2 VSIX first (SHA-256 in `docs/phase-10.1-release-qualification.md`). Mark each box ☐ → ☑. Note anything confusing, slow or wrong.

**Find and replace**
- ☐ Open `plain.txt` with Folio. Ctrl+H, find a word that appears twice, type a replacement and click **Replace**: only the current match changes. Press Enter in the **Replace with** box: the next match changes.
- ☐ The same in `notes.md` (Visual) and in your DOCX.

**Italic**
- ☐ In `notes.md` and your DOCX, select text and press Ctrl+I or click **Italic**: the text slants in the editor. Save and reopen: it is still italic. The DOCX shows italic in Word.
- ☐ Export `notes.md` with **Export → Export PDF…**. Italic text is italic in the PDF.

**Markdown cleanliness**
- ☐ In a new Markdown file, add a checklist directly followed by a bulleted list, then a paragraph and another list. Save and open the file in the text editor. There is no blank line between list items. At most one `<!--folio:boundary-->` appears, between the two adjacent lists.

**XLSX shortcuts**
- ☐ Click a cell and press Ctrl+B, Ctrl+I and Ctrl+U: the cell toggles bold, italic and underline, and VS Code's side bar does not open or close.
- ☐ Double-click a cell, select some of its text and press Ctrl+B: the whole cell turns bold and you keep typing in the cell. Press Enter: the text and bold are kept.
- ☐ Click into the formula bar and press Ctrl+B: the selected cell toggles bold.

**XLSX formulas**
- ☐ Open `folio-features.xlsx`. In an empty cell type `=SUM(1,2,3)` and press Enter: the cell shows 6 and a notice says local calculation is on. `=SUM(C2, C3)` shows the sum of those cells.
- ☐ Insert a row above data referenced by a formula. The formula still points to the right cells and shows the right result. Rename a sheet: references follow.
- ☐ Close the workbook without saving and reopen it. Insert a row again without typing a formula. Any formula Folio had to change shows **Not calculated**, and a banner offers **Enable calculation**. Click it: the results appear and the banner goes away.

**PDF**
- ☐ Open a PDF with three or more pages. Type a page number in the page box and press Enter: Folio jumps to that page.

**Recovery**
- ☐ Edit a DOCX or XLSX without saving and close VS Code (hot exit). On restart the edit is back and the tab shows unsaved changes. Make one more edit: Ctrl+Z undoes that edit and keeps the restored draft. **File: Revert File** discards the draft and shows the saved file.

**Appearance**
- ☐ Choose Folio's own **Dark** in Appearance. The editor is neutral grey with no green tint, and only the accent you choose adds color. **Match VS Code** returns to your workbench theme's exact colors.
- ☐ Folio's **Light**, a VS Code light theme and a high contrast theme still look right.

**Quick regression**
- ☐ Repeat any round 1 item you want. The full round 1 list is in Git history (`30109ac`).

## Result

- ☐ Accept for publication, or
- ☐ Issues found (list them): ____________________
