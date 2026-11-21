# Folio in VS Code

## Milestone 1

The extension registers `folio.markdown` as an optional `CustomTextEditorProvider` for `.md` and `.markdown`. VS Code continues to open Markdown in the native Text Editor by default. **Reopen Editor With → Folio Markdown Editor** opens the shared Folio interface with Visual, Markdown, and Split views. [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)

Build with `npm run build:extension`. Start an Extension Development Host from the repository root with `code --extensionDevelopmentPath="$(pwd)/extension"`. For a local install, `npm run package:extension` builds `extension/dist/folio.vsix`.

## Shared editor and host adapters

| Area | Milestone 1 implementation |
| --- | --- |
| Editing surface | Both entry points use `src/App.tsx`, `src/editor/useDocument.ts`, Tiptap, CodeMirror, and the same Markdown parser and serializer. The VS Code adapter supplies a single live document. Each view has its own mode, cursor, and scroll. |
| Standalone storage | `src/host/browser.ts` retains the IndexedDB workspace, local appearance preferences, document library, exports, and version history. |
| VS Code adapter | `src/host/vscode/host.ts` supplies the live document, clipboard, session-local preferences, and cancellable search worker to the shared host interfaces. `extension/src/extension.ts` uses VS Code for document editing and saving. VS Code owns tabs, dirty state, undo, redo, and persisted files. |

## Synchronization and recovery

The extension host binds a session to a `TextDocument`. Each webview sends edits tagged with the base version and a panel-local request ID. The host serializes submissions, checks that the document is still available and at the expected version immediately before `WorkspaceEdit`, then acknowledges the edit with document state. The bridge uses LF text with UTF-16 offsets and converts edits back to the document's line endings for VS Code. VS Code owns BOM and file encoding. [VS Code document and workspace APIs](https://code.visualstudio.com/api/references/vscode-api)

`onDidChangeTextDocument` publishes native edits, undo, redo, and external file reloads accepted by VS Code. Remote projections are marked so CodeMirror and ProseMirror update without echoing changes. The webview keeps one edit in flight and can rebase provably disjoint edits. When the ranges overlap or the host refuses a change, the view displays the native text and exposes the pending Markdown for copying or manual reconciliation. An unavailable or moved document becomes read-only while that view is open. Reopen a renamed file at its new location from VS Code.

Pending text and conflict recovery are kept in memory. VS Code's normal dirty buffer and hot exit apply after the host accepts an edit. A webview or process close before delivery can lose work that only existed in that view. A single changed range represents pending edits, so several edits coalesced into one range can require manual reconciliation even when a detailed merge could resolve them. Undo grouping follows the submitted workspace edits.

## Webview security

The provider rewrites trusted, built assets with `asWebviewUri`, restricts `localResourceRoots` to the webview bundle, and starts the Content Security Policy at `default-src 'none'`. It permits scripts from the approved webview resource origin, a bundled blob worker for regex, and inline styles used by CodeMirror and rich formatting. Remote images and general network requests are blocked by the policy. The bridge validates message shape and edit bounds, binds requests to the view's document, and disposes panel listeners and file watchers. [VS Code webview security](https://code.visualstudio.com/api/extension-guides/webview#security)

## Tests and next milestone

Run `npm run test:extension` with desktop VS Code installed. `FOLIO_VSCODE_EXECUTABLE` can point to the application binary. The harness starts VS Code with an isolated profile and uses real editor operations. The standalone commands remain `npm test`, `npm run build`, and `npm run test:e2e`.

The next milestone can add native command and theme settings, workspace-aware links and attachments, and broader platform and resource coverage. Keep native save, undo, and URI handling in the extension host as those capabilities are added.
