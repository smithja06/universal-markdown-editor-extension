# Folio 0.1.0 personal acceptance checklist

Use synthetic files only. Do not use personal workbooks or documents. About 30–45 minutes.

## Install

1. Use your normal desktop VS Code 1.148 on Windows. Folio adds editors only through **Open with Folio**, so your defaults do not change. To keep your normal profile untouched, create a profile first: **Profiles: New Profile…**, named for example "Folio test", and switch to it.
2. Install the candidate. Use the **Extensions: Install from VSIX…** command and pick the file, or run:
   ```powershell
   code --install-extension "C:\Users\xxjad\OneDrive\Desktop\Personal VSCode\universal-markdown-editor-extension\extension\dist\folio.vsix"
   ```
   Check the SHA-256 in `docs/phase-10.1-release-qualification.md` first: `Get-FileHash <path> -Algorithm SHA256`.
3. Make a test folder on `C:` outside OneDrive, for example `C:\FolioTest`. Open it with **File → Open Folder** and trust it.
4. Copy the demo files into it:
   - Run `npm run interop:xlsx` in the repository. Copy `test-results\interop\xlsx\folio-features.xlsx` and `folio-structure.xlsx`.
   - Create `notes.md`, `plain.txt` and `inventory.csv` yourself with a few lines each.
   - Make a DOCX in Word with a heading, a bulleted list and a 3×3 table.
   - Use any PDF Folio exports in step 7.

Uninstall afterwards with `code --uninstall-extension smithja06.folio-markdown-editor`, or delete the test profile.

## Checks

Mark each box ☐ → ☑. Note anything confusing, slow or wrong.

**Opening with Folio**
- ☐ Right-click `notes.md` → **Open with Folio**. The Folio editor opens. Normal double-click still opens VS Code's text editor.
- ☐ The same works from an editor tab's context menu and from **Folio: Open with Folio** in the Command Palette.

**Markdown**
- ☐ Type in Visual: a heading, bold text, a checklist and a table (Insert menu). Switch to Markdown and Split (also Ctrl+Alt+Shift+V/M/S). Both panes stay in sync.
- ☐ Ctrl+S saves. Close and reopen: the content is unchanged. Open the file in the text editor: the Markdown is clean.
- ☐ Undo/Redo (Ctrl+Z/Ctrl+Y) across several edits and across a mode switch.

**TXT**
- ☐ Open `plain.txt` with Folio. Edit, find/replace (Ctrl+F), save, close and reopen.

**DOCX**
- ☐ Open your DOCX with Folio. Apply bold and italic, add a list item, resize a table column, and add a table row.
- ☐ Ctrl+S. The first Save asks to replace the file and lists losses. Read it, then confirm.
- ☐ Open the saved file in Word: the text, list and table are intact.
- ☐ **Save As** to a new name works and refuses to overwrite an existing name.

**XLSX**
- ☐ Open `folio-features.xlsx`. Check the formats ($, %, date), bold and fill, borders, the merged title and the colored conditional cells.
- ☐ In the formula bar type `=SUM(` and pick a suggestion. Confirm the result.
- ☐ Insert a row above data referenced by a formula. The formula still points to the right cells. Rename a sheet: references follow.
- ☐ Open **Cell styles and themes** (layers icon) → **Workbook theme…**, apply another theme, then apply an **Accent** style to a cell.
- ☐ Ctrl+S. Confirm the first Save. Reopen in Folio, then open in Excel (read-only is fine): there is no repair prompt, and values and formatting match.
- ☐ Select a range and choose **Export → Export selected range as PNG…**.

**CSV**
- ☐ Open `inventory.csv` with Folio. Leading zeros stay. Edit a cell, save, then open in the text editor: only that field changed.

**PDF**
- ☐ From `notes.md` choose **Export → Export PDF…**. Review the fidelity notes and the preview, then **Save PDF copy…** to a new name.
- ☐ Open that PDF with Folio. Check page navigation, zoom, fit width, search (highlight), select text, Ctrl+C, and paste elsewhere.

**Recovery**
- ☐ Edit a DOCX or XLSX without saving and close VS Code (hot exit). On restart the edit is back and can be undone.
- ☐ With a file open in Folio, change it in another app, then try Save. Folio refuses and keeps your draft.

**Appearance**
- ☐ Switch VS Code between light, dark and a high contrast theme. Folio follows.
- ☐ Choose Folio's own **Light**/**Dark** and an accent in Appearance. Other open Folio editors follow, and the choice survives a restart. **Match VS Code** returns to the workbench colors.

## Result

- ☐ Accept for publication, or
- ☐ Issues found (list them): ____________________
