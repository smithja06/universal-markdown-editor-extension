# Folio in VS Code

## Entry point

Register Folio as an optional custom text editor for `*.md` files in a future extension. Use `CustomTextEditorProvider` with `customEditors.priority` set to `option`. VS Code continues to open Markdown in its native text editor by default. Users can choose Folio under **Reopen Editor With**, use Visual or Split, and switch back to the native editor. The VS Code `TextDocument` owns the Markdown buffer, dirty state, undo, save, and hot exit. [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)

## Shared code and host services

| Layer | Reusable code | VS Code integration |
| --- | --- | --- |
| Markdown and editing | `src/document/markdown.ts`, `markdownHtml.ts`, `metadata.ts`, and `src/editor/schema.ts`, `visualProjection.ts`, `markdownSelection.ts`, and `sourceDiagnostics.ts` | Run the parser and serializer in the webview. Keep exact source slices and preserve unsupported content. HTML parsing and the interactive editor require a DOM. |
| Editing surface | Tiptap and CodeMirror, split scroll, search decorations, and the local editing controls | Mount one Folio surface per webview. Let VS Code own editor groups and tabs. Extract the single-document synchronization lifecycle from `useDocument.ts` before wiring persistence. |
| Search and commands | `src/core/commands.ts`, `core/search.ts`, `editor/documentSearch.ts`, and the interfaces in `host/contracts.ts` | Connect native commands to stable Folio IDs through the bridge. Route host-owned shortcuts through VS Code and keep editor-local keys available when the webview has focus. Supply a cancellable search implementation. |
| Storage and files | Markdown encoding and portable file contracts | Use the live `TextDocument` for open file edits. Use workspace APIs for attachment and export I/O, with URI-aware resource resolution. Keep optional Folio version snapshots separate from native document state. |
| Preferences and feedback | Per-mount view store and injected appearance, clipboard, and notification services | Bind application preferences to settings, map Folio's semantic variables to VS Code theme and editor-font tokens, and cover high-contrast themes. Route clipboard, notifications, and workspace file actions through the extension host. |

The standalone entry point injects `src/host/browser.ts`, which retains the IndexedDB workspace, local appearance preferences, browser file access, and regex worker. A future webview entry point can inject its own host services and reuse the editor code. Keep the native document lifecycle distinct from the standalone multi-tab library and its IndexedDB autosave scheduler. [Webview API and theming](https://code.visualstudio.com/api/extension-guides/webview)

## Synchronization

1. Send initial text, URI, and `TextDocument.version` to the webview. Give each view its own cursor, scroll, and display mode. Use the full resource URI so local, remote, virtual, and untitled documents stay distinct.
2. Send small range edits with the base document version and a request ID. Serialize submissions per URI, check the current version immediately before applying a `WorkspaceEdit`, and acknowledge the resulting version and text. Keep dirty content recoverable when the base becomes stale. Let the user review or reconcile conflicting text.
3. Broadcast `onDidChangeTextDocument` to every view of that URI, including changes from the native editor, undo, and external file reloads that VS Code has accepted. Suppress edit echoes when applying remote text to ProseMirror or CodeMirror. Tie Folio's undo and redo commands to the shared VS Code history and check split-view caret mapping after external edits. [VS Code workspace and document APIs](https://code.visualstudio.com/api/references/vscode-api)

## Webview security and rollout

Use `asWebviewUri` for bundled assets and narrow `localResourceRoots` to resources the view needs. Start from a restrictive Content Security Policy and test the actual Vite output, including dynamic imports, workers, fonts, and editor-generated styles. For regex, use a bundled single-file worker loaded through an allowed blob URL or run the cancellable matcher behind the host interface. Version messages and validate their shape, URI, revision, ranges, and command arguments in the extension host. Continue sanitizing document HTML, diagrams, and link and image URLs. Gate workspace attachment access and external network activity according to the extension's workspace trust policy. [Webview security and workers](https://code.visualstudio.com/api/extension-guides/webview#security)

1. Build a future opt-in editor that opens the active document, edits Markdown through VS Code, and preserves undo, save, and native reopening.
2. Add Visual and Split synchronization across two Folio views and the native editor. Test external writes, stale changes, CRLF, BOM, renames, untitled files, and remote resources.
3. Wire native commands, keyboard contexts, theme tokens, clipboard, and attachments. Verify CSP and asset loading before enabling Mermaid, math, and export in the webview.
4. Validate with the VS Code extension test runner on Windows and macOS. Include dirty close and hot exit, high contrast, and opening the same file in native and Folio editors. Compare output against the standalone round-trip fixtures before packaging.
