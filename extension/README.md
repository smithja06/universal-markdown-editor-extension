# Folio Markdown Editor

Folio offers optional VS Code editors for Markdown, plain text, supported Word documents, XLSX workbooks and CSV files, and a read-only PDF viewer. Right-click a supported file in the Explorer or an editor tab and choose **Open with Folio**, run **Folio: Open with Folio** from the Command Palette, or use **Reopen Editor With…**. VS Code's native editors remain the default.

Use **Visual** for rich editing, **Markdown** for source, or **Split** to see both. Folio exposes mode changes, document properties, and heading navigation through the Command Palette and the editor title’s **Folio** submenu. Mode shortcuts are Ctrl+Alt+Shift+V/M/S on Windows and Linux and Cmd+Option+Shift+V/M/S on macOS. The shortcuts apply while Folio is active and an input does not have focus.

## Appearance

Folio matches your VS Code color theme by default. To use Folio's own palette, open **Document properties → Appearance** in the Markdown, TXT and DOCX editors, or select the **Appearance** button in the spreadsheet and PDF editors. Then choose **Light** or **Dark** and drag the **Accent color** bar. Your choice applies to every open Folio editor and is kept for later sessions. Choose **Match VS Code** to return to the workbench colors.

## Plain text and Word documents

- **Folio Plain Text Editor** opens `.txt` as literal text with find/replace, native Save, Undo/Redo and Revert. The qualified editing scope is local UTF-8 with optional BOM and uniform LF or CRLF, up to 16 MiB. Folio displays mixed and CR-only line endings read-only because VS Code's own Save can normalize them.
- **Folio DOCX Editor** opens the supported `.docx` subset for visual editing, find/replace, native Undo/Redo, and recovery. Use **Export → Export DOCX copy…** to review fidelity changes and download a validated copy. **Download original** retrieves the opened package. **File → Revert to disk** loads the current file. Native Save and Save As report the copy workflow and leave the draft dirty. Complex or invalid packages open with an explanation.

## PDF viewing and export

- **Folio PDF Viewer** opens local `.pdf` files read-only with page navigation, zoom and fit modes, embedded-text find with highlights, and text selection and copy. Pages without embedded text are labelled, and Folio does not perform OCR. Scripts, links, form fields and attachments in the PDF are inert. Password-protected PDFs open with an explanation. If the file changes on disk, choose **Reload from disk**. Folio never writes PDFs you view.
- In the Markdown, TXT and DOCX editors, use **Export → Export PDF…** to choose the page size, orientation, margins and file name, review fidelity changes and a validated preview, then select **Save PDF copy…**. Folio saves only to a new local `.pdf` file and never replaces an existing one. If the document changes after the preview, export again from the current revision.

## Install a VSIX

This package requires desktop VS Code 1.100 or later. Release-candidate testing uses desktop VS Code on Windows. See the [platform qualification record](https://github.com/smithja06/universal-markdown-editor-extension/blob/main/docs/extension-qualification.md) for the tested build, filesystem, and coverage.

In the Command Palette, run **Extensions: Install from VSIX…** and select `folio.vsix`. Or run `code --install-extension path/to/folio.vsix`. Folio requires a trusted workspace. If the workspace is in Restricted Mode, continue using the native Text Editor or grant trust through VS Code when you trust that workspace.

## Workspace images and links

In Visual or the Visual pane of Split, open **Insert content → Image or image caption**. In Markdown or the Source pane of Split, open **Insert image**. Select **Browse workspace images**, choose an existing raster image in the document’s workspace folder, and add alternative text. Select **Insert** or press Enter. The generated reference is relative to the Markdown document.

- Browsing requires a local Windows workspace on a fixed NTFS drive. macOS, Linux, VS Code Remote, non-file providers, and other Windows volume types display a message when you try to browse. You can enter a relative image reference manually.
- The picker accepts PNG, JPEG, GIF, WebP, AVIF, BMP, and ICO up to 5 MiB. Folio checks the selection again when you insert it. If the document or selection changed, reopen **Insert image** at the intended location.
- Folio reads existing images and writes the reference as Markdown. Automatic uploads are disabled. If you move or replace the image, the preview can change or break.
- Existing workspace raster images render in Visual and Split. Ctrl+click or Cmd+click follows a relative workspace Markdown link. Provider behavior varies. Network images are blocked in the webview.

## Pending edits and privacy

If an interrupted edit or a conflict leaves a pending draft, reopen a Markdown file in the same VS Code workspace. **View pending Markdown** and **Copy pending draft** let you inspect and reconcile the change. Folio keeps the original file URI after a move or deletion and leaves reconciliation to you. A native Save writes edits that VS Code has received. In-app Save waits for Folio’s pending changes to settle first.

Folio has no extension telemetry. The extension processes Markdown and image previews in VS Code and stores recovery copies in the webview’s local storage and VS Code’s workspace storage. Pending drafts can contain document text. A crash before either copy is stored, storage failures, or removal of profile data can limit recovery. VS Code manages its own telemetry settings.

TXT offers the same manual review and copy of pending text. For DOCX, reopen the document and use **View pending DOCX → Restore draft as an edit** when the package matches. After an extension-host interruption, the old custom-editor tab may need to be closed first. VS Code hot exit can restore a DOCX backup that includes the original package. These backups and journals are local and can contain document content.

## Build from source

Use Node 22.13+ on the 22.x line or Node 24+. Run these commands from the repository root.

```sh
npm ci
npm run package:extension
```

Install the resulting `extension/dist/folio.vsix`. The build uses the lockfile. The package includes Folio's MIT license, `EPL-1.0.txt`, and third-party notices, including `dist/PDF_THIRD_PARTY_NOTICES.txt` for pdf.js, pdfmake and the embedded PDF fonts. The top-level notices link to the upstream ELK, EMF GWT, and Xbase sources. This candidate is for local validation while the release source archive and distribution terms are reviewed. Run `npm run test:extension` for the isolated desktop tests. Set `FOLIO_VSCODE_EXECUTABLE` to the installed VS Code application binary if discovery fails.
