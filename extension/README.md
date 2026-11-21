# Folio Markdown Editor

Folio is an optional Markdown editor for Visual Studio Code. Open a `.md` or `.markdown` file, choose **Reopen Editor With…**, then select **Folio Markdown Editor**. Use the mode selector to switch between Visual, Markdown, and Split. The standard Text Editor remains available, and VS Code manages the document, save, undo, and redo.

If an interrupted edit or conflict leaves a pending draft, Folio offers it for review when you next open a Markdown file in the same workspace. Use **View pending Markdown** to inspect it and **Copy pending draft** to reconcile your changes in VS Code. On a conflict, you can also inspect the VS Code version captured at the time. Drafts retain their original file URI after moves or deletion.

## Build from source

From the repository root, run `npm ci` and `npm run package:extension`. Install `extension/dist/folio.vsix` with **Extensions: Install from VSIX…** in VS Code.

To test against a local desktop installation, run `npm run test:extension`. Set `FOLIO_VSCODE_EXECUTABLE` to the VS Code application binary if it is installed in a nonstandard location.
