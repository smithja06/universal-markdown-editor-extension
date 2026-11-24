# Folio Markdown Editor

Folio is an optional Markdown editor for VS Code. Open a `.md` or `.markdown` file, choose **Reopen Editor With…**, and select **Folio Markdown Editor**. The native Text Editor remains the default. VS Code owns the document, Save, Undo, and Redo.

Use **Visual** for rich editing, **Markdown** for source, or **Split** to see both. Folio follows your VS Code theme and exposes mode changes, document properties, and heading navigation through the Command Palette and the editor title’s **Folio** submenu. Mode shortcuts are Ctrl+Alt+Shift+V/M/S on Windows and Linux and Cmd+Option+Shift+V/M/S on macOS. The shortcuts apply while Folio is active and an input does not have focus.

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

## Build from source

Use Node 22.13+ on the 22.x line or Node 24+. Run these commands from the repository root.

```sh
npm ci
npm run package:extension
```

Install the resulting `extension/dist/folio.vsix`. The build uses the lockfile. The package includes Folio's MIT license, `EPL-1.0.txt`, and third-party notices. The top-level notices link to the upstream ELK, EMF GWT, and Xbase sources. This candidate is for local validation while the release source archive and distribution terms are reviewed. Run `npm run test:extension` for the isolated desktop tests. Set `FOLIO_VSCODE_EXECUTABLE` to the installed VS Code application binary if discovery fails.
