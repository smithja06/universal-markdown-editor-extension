# Folio in VS Code

## Phase 6 through Milestone 1.1

The extension registers `folio.markdown` as an optional `CustomTextEditorProvider` for `.md` and `.markdown`. VS Code continues to open Markdown in the native Text Editor by default. **Reopen Editor With → Folio Markdown Editor** opens the shared Folio interface with Visual, Markdown, and Split views. [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)

Build with `npm run build:extension`. Start an Extension Development Host from the repository root with `code --extensionDevelopmentPath="$(pwd)/extension"`. For a local install, `npm run package:extension` builds `extension/dist/folio.vsix`.

## Shared editor and host adapters

| Area | Implementation |
| --- | --- |
| Editing surface | Both entry points use `src/App.tsx`, `src/editor/useDocument.ts`, Tiptap, CodeMirror, and the same Markdown parser and serializer. The VS Code adapter supplies a single live document. Each view has its own mode, cursor, and scroll. |
| Standalone storage | `src/host/browser.ts` retains the IndexedDB workspace, local appearance preferences, document library, exports, and version history. |
| VS Code adapter | `src/host/vscode/host.ts` supplies the live document, clipboard, session-local preferences, and cancellable search worker to the shared host interfaces. `extension/src/extension.ts` uses VS Code for document editing and saving. VS Code owns tabs, dirty state, undo, redo, and persisted files. |

## Synchronization and recovery

The extension host binds a session to a `TextDocument`. Each webview connection sends edits tagged with the base version and a rising request ID. The host serializes edits from all views of the document, checks the version immediately before `WorkspaceEdit`, and acknowledges the exact resulting snapshot. The client checks the connection, request ID, revision, and accepted text before clearing a pending edit. A status request can retrieve the host's last acknowledgement. If the request times out, Folio preserves the draft for review and asks the host to cancel any application it has yet to start. [VS Code document and workspace APIs](https://code.visualstudio.com/api/references/vscode-api)

Every new draft generation is recorded synchronously in the webview's origin storage and sent to the host for backup in VS Code workspace storage. This includes keystrokes that arrive while the previous edit is awaiting acknowledgement. Both copies are scoped to the workspace and keyed by the view's recovery ID. A record includes the exact document URI and a generation number that protects newer drafts from older cleanup messages. After synchronization, Folio clears the corresponding recovery record. VS Code's normal dirty-buffer, save, and hot-exit behavior applies to committed edits. [VS Code webview origin persistence](https://code.visualstudio.com/updates/v1_73#_consistent-origin-for-webviews-and-webview-views)

`onDidChangeTextDocument` publishes native edits, undo, redo, and external file reloads accepted by VS Code. The view can rebase provably disjoint ranges. Overlap pauses editing in that view and records the complete Folio draft and the exact native Markdown at detection. Each snapshot retains its line endings and BOM metadata. The bridge uses LF-normalized text with UTF-16 offsets and VS Code retains the original file encoding when it saves.

On reopen, Folio displays the current VS Code document alongside any unresolved drafts. **View pending Markdown** and **Copy pending draft** let you inspect and reconcile the proposed text manually. Conflict records also expose the preserved VS Code version. **Discard pending draft** clears the recovery record after review. Drafts from renamed or deleted files retain their original URI and are accessible by opening another Markdown file in Folio in the same workspace. Recovery records are never replayed, including when a different file later occupies the original path.

Folio's Save, Undo, and Redo wait for its pending edits to settle. A native save can only save the text VS Code has received. An edit that arrives afterward can make the document dirty again. Undo grouping follows the submitted workspace edits. Coalesced edits that span a wide range can require manual reconciliation even when a finer merge could resolve them.

The recovery journals add one document-sized serialization and storage update per changed snapshot, plus a host backup sent asynchronously. Storage quotas and unusually large documents can affect typing latency or leave only one recovery copy. Folio warns when the current draft has no confirmed recovery copy. A renderer or system crash before either store records or flushes the draft, simultaneous storage failure, profile-data removal, and input still held by an IME can lose changes. Losing an acknowledgement or interrupting cleanup can leave a recovery copy for text that reached VS Code.

## Webview security

The provider rewrites trusted, built assets with `asWebviewUri`, restricts `localResourceRoots` to the webview bundle, and starts the Content Security Policy at `default-src 'none'`. It permits scripts from the approved webview resource origin, a bundled blob worker for regex, and inline styles used by CodeMirror and rich formatting. Remote images and general network requests are blocked by the policy. The bridge validates connection envelopes, message shapes, revisions, and edit bounds. It binds each active checkpoint to the host-assigned recovery ID and current text document URI. Recovery previews render as plain text, and the workspace backup uses local VS Code storage without Settings Sync. These recovery stores contain readable Markdown, so they share the sensitivity of the original document. Panel subscriptions, client timers, and file watchers are released with their owners. [VS Code webview security](https://code.visualstudio.com/api/extension-guides/webview#security)

## Tests and next milestone

Run `npm run test:extension` with desktop VS Code installed. `FOLIO_VSCODE_EXECUTABLE` can point to the application binary. The harness installs the production build into an isolated desktop profile and uses real buffer, panel, file, window, and extension-host operations. Its recovery fixtures can independently hold edit messages, block host checkpoints, or disable webview storage writes. The standalone commands remain `npm test`, `npm run build`, and `npm run test:e2e`.

The next milestone can add native command and theme settings, workspace-aware links and attachments, and broader platform and resource coverage. Keep native save, undo, and URI handling in the extension host as those capabilities are added.
