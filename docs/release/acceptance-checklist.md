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

The round 2 candidate also contains two features requested after round 1: a table size picker that locks on click, and DOCX font, size, color, highlight, strikethrough, alignment and indentation.

Install the round 2 VSIX first: SHA-256 `730c0db13528a93ac4d2b04402f001d042bed4286d89c428d79e9e7c27329168`, built from `72a5c32`. Mark each box ☐ → ☑. Note anything confusing, slow or wrong.

**Table size picker (new)**

- [x] &#x20;In `notes.md` choose **Insert → Table**. Move the pointer over the grid: the highlighted size follows it. Click a square: the line under the grid reads, for example, "3 × 4 table · Click another square to change the size."
- [x] Move the pointer across other squares and on to **Insert**: the size does not change, and squares you pass over only show a dashed preview. Click **Insert**: the table has the size you clicked. Click a different square first to change the size. Typing in **Rows** or **Columns** also keeps the size.
- [x] &#x20;The same in your DOCX.

**DOCX formatting (new)**

- [x] &#x20;In your DOCX select some text. Change **Font family** (try Calibri and Georgia) and **Font size**, which is shown in points as in Word. Change **Text color** and **Text highlight**, and click **Strikethrough**.
- [ ] NOTE: Text color doesnt register on the editor for doc x however it does register on the word file. i also notice that sometime when click on a line on the right side of the documnent it doesnt take you to that line and sometimes just brings you the the first character of the line below it or it just doesnt register at all.
- [x] &#x20;Use **Alignment** for left, center, right and justified paragraphs. In **More formatting** use **Increase indentation** and **Decrease indentation** (Ctrl+] and Ctrl+\[) on a paragraph or heading. Indentation is unavailable inside a list item, because Word lists use their own indentation.
- [ ] NOTE: indention works but you cant backspaace an indentation its lcoked and you must decrease indentation to remove it
- [x] &#x20;Ctrl+S, close and reopen with Folio: all formatting is kept.
- [x] &#x20;Open the saved file in Word: the font, size, color, strikethrough, alignment and indentation match. Folio's highlight colors appear as character shading, since Word's highlight tool has its own fixed colors.
- [x] &#x20;In Word, make a document with a font, a size, a font color, a yellow highlight, centered and justified paragraphs and an indent, then open it with Folio: they show in Folio. Theme fonts or theme colors are listed in **DOCX import notes** as approximations.

**Find and replace**

- [x] &#x20;Open `plain.txt` with Folio. Ctrl+H, find a word that appears twice, type a replacement and click **Replace**: only the current match changes. Press Enter in the **Replace with** box: the next match changes.
- [x] The same in `notes.md` (Visual) and in your DOCX.

**Italic**

- [x] &#x20;In `notes.md` and your DOCX, select text and press Ctrl+I or click **Italic**: the text slants in the editor. Save and reopen: it is still italic. The DOCX shows italic in Word.
- [x] Export `notes.md` with **Export → Export PDF…**. Italic text is italic in the PDF.

**Markdown cleanliness**

- [x] &#x20;In a new Markdown file, add a checklist directly followed by a bulleted list, then a paragraph and another list. Save and open the file in the text editor. There is no blank line between list items. At most one `<!--folio:boundary-->` appears, between the two adjacent lists.
- [ ] NOTE: only one appears between checklist and bulleted list &#x20;

**XLSX shortcuts**

- [x] &#x20;Click a cell and press Ctrl+B, Ctrl+I and Ctrl+U: the cell toggles bold, italic and underline, and VS Code's side bar does not open or close.
- [x] Double-click a cell, select some of its text and press Ctrl+B: the whole cell turns bold and you keep typing in the cell. Press Enter: the text and bold are kept.
- [x] &#x20;Click into the formula bar and press Ctrl+B: the selected cell toggles bold.

**XLSX formulas**

- [x] &#x20;Open `folio-features.xlsx`. In an empty cell type `=SUM(1,2,3)` and press Enter: the cell shows 6 and a notice says local calculation is on. `=SUM(C2, C3)` shows the sum of those cells.
- [x] &#x20;Insert a row above data referenced by a formula. The formula still points to the right cells and shows the right result. Rename a sheet: references follow.
- [x] &#x20;Close the workbook without saving and reopen it. Insert a row again without typing a formula. Any formula Folio had to change shows **Not calculated**, and a banner offers **Enable calculation**. Click it: the results appear and the banner goes away.

**PDF**

- [x] &#x20;Open a PDF with three or more pages. Type a page number in the page box and press Enter: Folio jumps to that page.

**Recovery**

- [x] Edit a DOCX or XLSX without saving and close VS Code (hot exit). On restart the edit is back and the tab shows unsaved changes. Make one more edit: Ctrl+Z undoes that edit and keeps the restored draft. **File: Revert File** discards the draft and shows the saved file.

**Appearance**

- [x] Choose Folio's own **Dark** in Appearance. The editor is neutral grey with no green tint, and only the accent you choose adds color. **Match VS Code** returns to your workbench theme's exact colors.
- [x] &#x20;Folio's **Light**, a VS Code light theme and a high contrast theme still look right.

**Quick regression**

- [x] &#x20;Repeat any round 1 item you want. The full round 1 list is in Git history (`30109ac`).

## Round 2 results (November 27, 2026, VSIX `730c0db1…`)

Everything passed except the notes above, so round 2 did not accept the release yet.

| Owner's note | Cause and fix |
| --- | --- |
| Clicking on the right side of a line sometimes goes to the first character of the line below, or does nothing. | Reproduced in VS Code. A click in the editor's padding beside a line, or in the space between paragraphs, has no text under it, so the browser chose the start of the next block. Folio now places the caret on the nearest line: at its end for a click to the right, and on the closer line for a click between paragraphs. Shift+click extends the selection. Table column resizing is unaffected. This applies to Markdown and DOCX. |
| DOCX text color doesn't show in the editor, but Word has it. | Not reproduced. In VS Code, color showed in headings, paragraphs, links, lists and table cells, both while selected and after. The likely cause is the click problem above: after a click on the right of a line the caret sat at the start of the next line, so a following Shift+Home selected nothing and the color went somewhere else. Re-test below. Also note that **Ink**, the first color, is almost the default text color in light themes. |
| An indent can't be removed with Backspace. | Backspace at the start of an indented paragraph or heading now removes one indentation step, as in Word. At no indentation it joins lines as before. This applies to Markdown and DOCX. |
| Only one `<!--folio:boundary-->` appears, between the checklist and the bulleted list. | That is the expected result. Two different Markdown lists directly next to each other need a separator, or every Markdown reader would merge them into one list. |

## Round 3 re-test

Install the round 3 VSIX: SHA-256 `6c4cde7f6535d4841b972719e844032d092afbec824366f5a0a278202b60f9fc`, built from `63894ca`.

- ☐ In your DOCX and in `notes.md`, click to the right of the text on several lines, including short lines, a heading and a list item: the caret goes to the end of that line. Click in the space between two paragraphs: the caret goes to the nearer line. Shift+click to the right of a later line selects up to its end.
- ☐ Select a few words by clicking to the right of a line and pressing Shift+Home, or by dragging. Choose **Text color → Ocean** or **Brick**: the words change color in the editor. Save and reopen: the color is kept. Word shows the same color.
- ☐ Indent a paragraph twice. Put the caret at its start and press Backspace: one indentation step goes. Press Backspace again: the indentation is gone. Press it once more: the paragraph joins the one above, as before.
- ☐ Table columns still resize by dragging a column border, in DOCX and Markdown.

## Result

- ☐ Accept for publication, or
- ☐ Issues found (list them): \_\_\_\_\_\_\_\_CHECK NOTES ABOVE ONLY A FEW LEFT\_\_\_\_\_\_\_\_\_\_\_\_
