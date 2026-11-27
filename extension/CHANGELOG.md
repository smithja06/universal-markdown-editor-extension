# Folio Markdown Editor changelog

## 0.1.0 (release candidate, not yet published)

First release of Folio's optional VS Code editors. Qualified on desktop VS Code 1.100.0, 1.147.0 and 1.148.0 on Windows 11 x64. Other platforms are not yet qualified.

### Editors

- **Markdown:** Visual, Markdown source and Split modes with VS Code Save, Undo/Redo and hot exit. Unchanged Markdown stays byte-for-byte. Tables, callouts, checklists, Mermaid, KaTeX math, footnotes, wiki links and a live table of contents. Workspace images render, and relative Markdown links can be followed.
- **Plain text:** literal UTF-8 editing with find and replace, Save, Undo/Redo and Revert. Mixed line endings open read-only.
- **DOCX:** visual editing of the supported Word subset, including font, size, color, highlight, strikethrough, alignment and indentation, and rectangular tables with column resizing. Unsupported content is explained instead of silently changed.
- **XLSX and CSV:** spreadsheet grid with formatting, conditional formatting, merges, worksheet management, regional settings and range PNG export. Formulas use IronCalc 0.9.1, with a formula bar, verified function suggestions and argument hints. Row and column insert and delete and sheet rename update formulas. Workbook themes have accent colors. CSV values stay literal.
- **PDF:** read-only viewer with navigation, zoom, search and copy. Active PDF content stays inert.
- **PDF export** from Markdown, TXT and DOCX, after a fidelity review and validated preview. Copies are saved only as new files. Exports include a language, a title and bookmarks. They are untagged and do not claim PDF/UA.

### Saving and recovery

- On Windows local fixed NTFS drives, **Save** for DOCX, XLSX and Folio's CSV grid replaces the opened file in place. Folio holds an exclusive lock, checks the file's fingerprint, reads back the written bytes to verify them, and keeps a save journal. The first Save lists what the original will lose. **Save As** creates new files only. On other drives and platforms, Folio keeps recoverable drafts and offers exported copies.
- An interrupted save is recognized on reopen and can be finished or reversed. Tests include injected disk-full and flush failures, failed rollback, journal storage failure and a writer process killed mid-write.
- Pending-draft review for Markdown, TXT and DOCX after conflicts or interruptions.

### Appearance and access

- Folio matches the VS Code theme by default. Choose Light or Dark with an accent color in any Folio editor.
- Open any supported file with **Open with Folio** from the Explorer, an editor tab or the Command Palette.

### Privacy and licensing

- No telemetry, and no network access for document content.
- MIT licensed. The package includes third-party notices for Mermaid's Eclipse Layout Kernel runtime (EPL 2.0 and EPL 1.0 texts, Unicode License), pdf.js, pdfmake and its fonts, IronCalc, and the DOCX and workbook codecs. A corresponding-source archive for the Eclipse-licensed components will be published beside the release.
