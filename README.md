# Folio

Folio is a browser-based Markdown document editor. Write in the visual editor, switch to the CodeMirror source editor, and open or export UTF-8 Markdown files locally.

## Run locally

Use Node.js 22.12 or newer and npm.

~~~sh
npm ci
npm run dev
~~~

Open the localhost URL printed by Vite. For a production build, run `npm run build` and serve `dist/` with a static web server. No backend or account is required.

~~~sh
npm test
npx playwright install chromium
npm run test:e2e
~~~

The browser tests can use an existing Chromium installation via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Editing and files

- Switch with **Markdown Source** or **Visual Editor**. In visual mode, type `/` on an empty line for insertion commands. Drag top-level blocks with their handles or use **Edit → Move block up/down**.
- The **Insert** menu includes callouts, checklists, images, tables, Mermaid, equations, links, footnotes, and a live table of contents. Click an equation or double-click an image to edit it. Select a table cell to show table controls.
- The properties sidebar includes a heading outline, a YAML form and raw editor, appearance settings, and document statistics.
- **File → Open Markdown** and file drop accept `.md` and `.markdown`. Local images are embedded as data URLs so the Markdown file can travel with its images. Saving uses the browser file picker where available and downloads a copy otherwise.
- **Saved locally** means the draft is in the browser’s IndexedDB. The title’s dot tracks changes since the last file save. **Export** can download Markdown or HTML and copy Markdown or rendered text. Browser storage is scoped to the origin and profile.

## Markdown and round trips

Folio uses CommonMark and GitHub Flavored Markdown for ordinary blocks, tables, task lists, strikethrough, autolinks, and references. YAML front matter is stored as a ProseMirror document attribute so the body and metadata participate in the same undo history.

| Feature | Source convention |
| --- | --- |
| Callouts | A blockquote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`, or `[!INFO]` |
| Mermaid | Fenced code with the `mermaid` language |
| Math | Inline `$…$` or a block delimited by lines of `$$` |
| Wiki links | `[[Target]]` or `[[Target\|Label]]` |
| Table of contents | `[[TOC]]` on its own line. Headings get distinct anchors in visual navigation and HTML export |
| Inline rich styles | `<u>`, `<sup>`, `<sub>`, and `<span style="…">` inside Markdown. Folio uses these for underlining, superscript, subscript, color, highlighting, and font settings |
| Rich block layout | A standalone HTML element such as `<p style="text-align: center">…</p>` or `<table>…</table>`. Folio keeps small `data-folio-*` attributes when a property has no equivalent HTML attribute, such as the Title or Subtitle style |
| Legacy Folio HTML | Folio opens `<div data-folio-block="1">…</div>` and keeps its original text until the block is edited. An edited block is written in the simplest form that preserves its content |
| Block boundaries | Folio can add `<!--folio:boundary-->` when Markdown would otherwise merge separate blocks, such as adjacent lists |

An unchanged document returns its original Markdown, including whitespace, fence styles, delimiter choices, BOM, and line endings. A visual edit reuses original top-level blocks and their spacing where the parser can still distinguish them. Folio also tries to patch individual text runs in place. An edited block can acquire equivalent Markdown delimiters. Empty visual paragraphs use Markdown’s normal blank-line spacing when saved and reopened.

Unsupported HTML, generic Markdown directives, reference definitions, and lists mixing checked and ordinary items are represented by marked source fragments in the visual editor. These fragments remain editable in source mode. If an unclosed block would absorb content inserted after it, Folio can close an editable fence or store the opaque fragment in an HTML element that retains its original text. A file with mixed line endings keeps its exact bytes until edited, after which the first detected line ending is used.

The visual editor renders Mermaid and KaTeX. The HTML adapter emits MathML for equations and code for Mermaid diagrams. Wiki targets remain local document references, and an arbitrary extension can have different rendering in another Markdown app.

## Architecture

- `src/editor/schema.ts` defines the canonical ProseMirror schema and supported rich content. `src/editor/nodeViews.tsx` provides interactive previews, and `src/editor/SourceEditor.tsx` implements the CodeMirror surface.
- `src/document/markdown.ts` maps the Unified and Remark syntax tree to ProseMirror and records exact spans against top-level block identities. Serialization tries native Markdown first, then inline HTML and standalone block HTML as needed. `src/document/markdownHtml.ts` limits which HTML becomes editable and reads legacy Folio markup.
- `src/editor/useDocument.ts` reads the active editor when switching modes, exporting, or saving a draft. It reuses unchanged ProseMirror blocks and records incoming changes in the applicable history. Source edits that only change delimiters stay in source history. `src/editor/markdownSelection.ts` maps the caret to nearby text in the corresponding block.
- `src/document/files.ts` handles Markdown byte encoding, browser disk I/O, and the attachment interface. `src/document/workspace.ts` handles IndexedDB drafts and Zustand preferences. `src/document/export.ts` handles the rendered HTML and text exporters.

For a future file format, add a format-specific codec and exporter at the document boundary. A compatible rich-text format can project into the existing schema with its own fidelity rules. A spreadsheet or fixed-layout PDF can use a separate model and editor while sharing file identity, recent documents, and the workspace shell.
