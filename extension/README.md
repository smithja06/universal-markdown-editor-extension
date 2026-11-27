# Folio Universal Editor

Folio adds optional, local-first editors to desktop VS Code. You can write Markdown visually or as source, edit plain text, supported Word documents, Excel workbooks and CSV files, view PDFs read-only, and export reviewed PDF copies. VS Code's built-in editors stay the default. You choose Folio per file.

> **Folio is not a complete replacement for Microsoft Word, Microsoft Excel or Adobe Acrobat.** It edits a documented subset of each format. When a file contains something Folio cannot keep, Folio tells you before saving and never changes the original without your confirmation.

## Supported formats

| Format | Folio editor | What you can do |
| --- | --- | --- |
| Markdown (`.md`, `.markdown`) | Folio Markdown Editor | Visual, Markdown source and Split editing with VS Code Save and Undo |
| Plain text (`.txt`) | Folio Plain Text Editor | Literal text editing with find and replace, Save, Undo and Revert |
| Word (`.docx`) | Folio DOCX Editor | Visual editing of the supported subset, tables, Save and Save As on qualified Windows |
| Excel (`.xlsx`) | Folio XLSX Editor | Spreadsheet grid with formulas, formatting, themes, Save and Save As on qualified Windows |
| CSV (`.csv`) | Folio CSV Editor | Spreadsheet grid with literal values. VS Code's text editor stays the default for CSV. |
| PDF (`.pdf`) | Folio PDF Viewer | Read-only viewing, search and copy. PDF export from Markdown, TXT and DOCX. |

## Open a file with Folio

- Right-click a supported file in the Explorer or an editor tab and choose **Open with Folio**.
- Or run **Folio: Open with Folio** from the Command Palette.
- Or use **Reopen Editor With…** and pick the Folio editor.

To go back, use **Reopen Editor With…** and choose **Text Editor**.

## Markdown: Visual, Markdown and Split

Choose **Visual** for rich editing, **Markdown** for source, or **Split** to see both side by side with optional synchronized scrolling. Every edit goes through VS Code's own document, so Save, Undo/Redo, dirty state and hot exit work as usual. Folio keeps unchanged Markdown byte-for-byte, including whitespace, fence styles and line endings.

Visual mode supports headings, lists and checklists, tables with row and column commands and resizing, callouts, Mermaid diagrams, KaTeX math, footnotes, links, wiki links and a live table of contents. Existing workspace raster images render in Visual and Split. Ctrl+click (Cmd+click on macOS) follows a relative Markdown link.

## Plain text

The Folio Plain Text Editor opens `.txt` files as literal text with find and replace, native Save, Undo/Redo and Revert. Editing is qualified for local UTF-8 files, with or without a BOM, with uniform LF or CRLF line endings, up to 16 MiB. Files with mixed or CR-only line endings open read-only, because saving would normalize them.

## Word documents (DOCX)

The Folio DOCX Editor opens the supported subset of `.docx` for visual editing: headings, paragraphs, bold, italic, underline, strikethrough, font, size in points, text color, highlight, alignment, paragraph indentation, lists, links, and rectangular tables with column resizing and row and column commands. It also supports find and replace, Undo/Redo, Revert and recovery. Complex packages, or tables with merged or nested cells, open with an explanation instead of being changed. **Download original** retrieves the exact package you opened.

## Spreadsheets (XLSX and CSV)

The Folio XLSX and CSV editors show a spreadsheet grid with:

- A toolbar for number, currency and percent formats, fonts, colors, borders, alignment and wrapping, merges, and conditional formatting.
- A formula bar with function suggestions and argument hints.
- Worksheet tabs to add, rename, reorder and delete sheets.
- Row and column insert and delete. Folio updates formulas that refer to them, including references from other sheets and after a sheet rename.
- Workbook themes with accent colors.
- Regional number and date settings.
- PNG export of a selected range.

**Formulas use the IronCalc engine (0.9.1).** Folio calculates common spreadsheet functions and suggests only functions verified against IronCalc. Formula text and Excel's stored results are kept. An existing workbook opens with its stored results, and calculation starts when you choose **Enable calculation** or type a formula. A formula with no result shows **Not calculated**. When a workbook contains functions IronCalc does not calculate, Folio shows Excel's stored results and tells you which values may be out of date. INDIRECT, OFFSET, external links and structured table references are not rewritten during row or column changes.

CSV cells are literal text, so leading zeros and long identifiers are never converted. Folio detects comma, semicolon, tab and pipe separators and keeps the original dialect when saving.

## Saving DOCX, XLSX and CSV in place

**Native Save requires Windows and a local file on a fixed NTFS drive.** There, **Save** writes your edits back to the file you opened. Folio checks that the file has not changed since you opened it, holds an exclusive lock while writing, reads the result back to verify it, and keeps a save journal so an interrupted save can be finished or undone the next time you open the file. A newer change from another app is never overwritten. The first Save of each file asks before replacing it in Folio's supported format and lists what the original will lose, such as Word page layout, or workbook charts and pivot tables. **Save As** always creates a new file and never replaces an existing one.

Everywhere else, including macOS, Linux, WSL, Remote windows, network drives and removable drives, in-place Save is not available for these formats. Folio keeps a recoverable draft, and the editor explains why. Use **Export DOCX copy…** or the spreadsheet **Export** menu to save a separate file. CSV files still save exactly as text when you edit them in VS Code's text editor.

## Original files and recovery

- Folio never writes to a file just by opening or viewing it.
- If another app changes or locks the file, Folio keeps your draft and tells you why. It does not overwrite the other change.
- Markdown and TXT edits live in VS Code's document. If an edit is interrupted or conflicts, **View pending Markdown** and **Copy pending draft** let you inspect and reconcile it.
- For DOCX, reopen the file and use **View pending DOCX → Restore draft as an edit**. Unsaved DOCX and workbook edits are also part of VS Code's hot exit backups and come back as an undoable edit when VS Code restores the editor.
- No save is immune to power loss or hardware failure. The save journal lets Folio recognize and finish or reverse an interrupted save.

## PDF viewing and export

- The **Folio PDF Viewer** opens local PDFs read-only, with page navigation, zoom and fit modes, embedded-text search with highlights, and text selection and copy. Scripts, links, form fields and attachments stay inert. Password-protected PDFs open with an explanation. Folio does not perform OCR and never writes a PDF you view.
- In the Markdown, TXT and DOCX editors, choose **Export → Export PDF…**. Pick the page size, orientation, margins and file name, review the listed fidelity changes and a validated preview, then choose **Save PDF copy…**. Folio saves only to a new file.
- Exported PDFs include a document language, a title and heading bookmarks. **They are not tagged and are not guaranteed to meet PDF/UA accessibility requirements.** Characters without a bundled font, such as CJK text and emoji, print as code points like `[U+4E2D]`.

## Appearance

Folio follows your VS Code color theme by default, including high contrast themes. To use Folio's own palette, open **Document properties → Appearance** in the Markdown, TXT and DOCX editors, or the **Appearance** button in the spreadsheet and PDF editors. Then choose **Light** or **Dark**, a neutral palette, and an accent color. The choice applies to every Folio editor and is kept between sessions.

## Keyboard shortcuts

| Action | Windows and Linux | macOS |
| --- | --- | --- |
| Visual mode | Ctrl+Alt+Shift+V | Cmd+Option+Shift+V |
| Markdown source mode | Ctrl+Alt+Shift+M | Cmd+Option+Shift+M |
| Split mode | Ctrl+Alt+Shift+S | Cmd+Option+Shift+S |
| Save | Ctrl+S | Cmd+S |
| Undo, Redo | Ctrl+Z, Ctrl+Y | Cmd+Z, Cmd+Shift+Z |
| Find | Ctrl+F | Cmd+F |
| Bold, italic, underline (Markdown, DOCX and spreadsheet cells) | Ctrl+B, Ctrl+I, Ctrl+U | Cmd+B, Cmd+I, Cmd+U |

The mode shortcuts apply in the Markdown editor when no input has focus. Folio's mode, properties and heading commands are also in the Command Palette under **Folio**.

## Privacy

Folio has no telemetry and makes no network requests for your documents. Documents are processed locally in VS Code. Network images are blocked in the editor. Recovery drafts and save journals are stored locally in VS Code's workspace and extension storage, and can contain document content. VS Code's own telemetry follows your VS Code settings.

## Supported environments

| Environment | Status |
| --- | --- |
| Desktop VS Code 1.100.0, 1.147.0 and 1.148.0 on Windows 11 x64 | **Qualified.** All editors, plus native Save on local fixed NTFS drives. |
| Other Windows drives (network, removable, non-NTFS) | Editors work. DOCX, XLSX and CSV grid edits use recoverable drafts and exported copies. |
| macOS, Linux, WSL, Remote and Codespaces | **Not qualified.** These have not been tested for this release. |
| VS Code for the Web | Not supported |

Folio requires a trusted workspace. In Restricted Mode, keep using VS Code's text editor.

## Known limitations

- DOCX: page layout, headers and footers, comments, tracked changes, text boxes, fields, merged or nested tables, and other unsupported content are listed before the first Save and are not kept. Theme fonts use Folio's default font, and theme colors use the fixed color Word stores with them. Both are listed as approximations. A highlight color outside Word's named highlight colors is saved as character shading. Fonts display only when installed on your computer.
- XLSX: charts, pivot tables, defined names, structured table metadata, external connections and other unsupported workbook parts are listed before the first Save and are not kept. Macros are rejected. Theme colors are stored as fixed colors. Files are limited to 16 MiB, 64 sheets and 150,000 cells.
- PDF export is untagged, has no OCR, and prints characters without a bundled font as code points.
- Image insertion references existing workspace images only. It is available on Windows NTFS workspaces only, and Folio never uploads or copies images.
- Native Save for DOCX and XLSX is limited to Windows local fixed NTFS drives.

## Install

This release candidate is distributed as a VSIX file. In VS Code, run **Extensions: Install from VSIX…** and select `folio.vsix`, or run:

```sh
code --install-extension path/to/folio.vsix
```

## License

Folio is licensed under the MIT license. Bundled third-party components keep their own licenses. See `THIRD_PARTY_NOTICES.md`, `EPL-1.0.txt`, `EPL-2.0.txt` and the notices in `dist/`. These cover Mermaid's Eclipse Layout Kernel runtime, pdf.js, pdfmake and its fonts, the IronCalc engine, the DOCX and workbook codecs, and the Unicode data they include.
