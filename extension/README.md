# Folio Markdown Editor

Folio is an optional Markdown editor for Visual Studio Code. Open a `.md` or `.markdown` file, choose **Reopen Editor With…**, then select **Folio Markdown Editor**. Use the mode selector to switch between Visual, Markdown, and Split. The standard Text Editor remains available, and VS Code manages the document, save, undo, and redo.

## Build from source

From the repository root, run `npm ci` and `npm run package:extension`. Install `extension/dist/folio.vsix` with **Extensions: Install from VSIX…** in VS Code.

To test against a local desktop installation, run `npm run test:extension`. Set `FOLIO_VSCODE_EXECUTABLE` to the VS Code application binary if it is installed in a nonstandard location.
