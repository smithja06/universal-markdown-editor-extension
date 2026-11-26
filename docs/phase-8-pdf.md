# Phase 8 PDF viewing and export

Phase 8 adds a read-only, page-oriented PDF viewer to standalone Folio and to VS Code, and exports eligible Markdown, TXT and DOCX documents as newly generated, validated PDF copies. An opened PDF is never converted to Markdown or to a rich-text draft. PDF content editing, OCR, annotation, form filling, signatures and redaction are out of scope. [Phase 8 boundary](phase-7-multiformat-foundation.md#phase-8-pdf-boundary) · [Capability matrix](release-capabilities.md)

## Library selection

| Need | Selection | Qualification |
| --- | --- | --- |
| Rendering, text extraction and selection | **pdf.js** (`pdfjs-dist` 6.5.438, Apache 2.0, pinned). Released 2026-11-01. | Runs locally in the browser and in the VS Code webview. Its worker is bundled with Vite `?worker&inline` and starts from a `blob:` URL, which the existing webview CSP (`worker-src blob:`) already allows. WASM decoders, worker fetches of CMaps, standard fonts and ICC profiles, XFA and worker rendering are disabled, so no `connect-src` or `wasm-unsafe-eval` relaxation is needed. The Node "legacy" build runs the same code in unit tests. |
| PDF generation | **pdfmake** 0.3.14 (MIT, pinned), released 2026-11-08, using its prebuilt browser bundle in a dedicated worker. | Provides text wrapping with mixed inline styles, nested lists, tables with spans and repeated headers, images, page sizes, orientation, margins, links, page numbering and TrueType embedding with subsetting. It runs without DOM access in a worker. The pdfmake URL resolver is locked with `setUrlAccessPolicy(() => false)`, and the Node build used in tests also gets `setLocalAccessPolicy(() => false)`. |
| Fonts | Roboto (four styles, Apache 2.0, from pdfmake) and DejaVu Sans Mono 2.37 (`dejavu-fonts-ttf` 2.37.3, pinned). | Fonts are inlined into the lazy export chunk as base64, so export never fetches resources. Roboto covers Latin, Greek and Cyrillic (927 code points). DejaVu Sans Mono covers 3,322 code points, including arrows, check marks, box drawing and mathematical operators. Folio uses it as a per-character fallback for body text. |

Alternatives considered: pdf-lib (no layout engine, so headings, lists, tables and pagination would all be custom code), jsPDF with `html()` (rasterizes HTML through html2canvas, producing non-searchable or approximate output), and the browser Print command (no file output Folio can validate or bind to a revision). A remote rendering service was not considered because it would send document content off the machine.

The pdfmake browser bundle is prebuilt with webpack. Vite therefore sees a single `pdfmake` module, and its generated notice inventory cannot list the components inside it. `public/PDF_THIRD_PARTY_NOTICES.txt` records pdf.js, pdfmake, both fonts and every component identified in the bundle with their license texts. Each text comes from the installed package or from the published npm package of the version pdfmake's build declares. [Distribution record](extension-distribution.md#phase-8-pdf-dependencies)

## Architecture

| Layer | Files | Responsibility |
| --- | --- | --- |
| Format model | `src/document/formats/pdf/model.ts`, `src/document/formats/content.ts` | `PdfContent` keeps page count, detected features and the immutable original reference. Its `source` is always empty because text is extracted from the original on demand. Resource limits, feature notices and the header check are defined here. |
| Engine | `src/document/formats/pdf/engine.ts`, `pdfjsWorker.ts`, `text.ts` | `openPdf` validates and opens a copy of the bytes, so the caller's original buffer is never transferred or mutated. It enforces size, page and time limits, maps password and parse errors to explicit rejections, reports scripts, forms, XFA, attachments, signatures and permission-only encryption, and destroys the worker on failure, cancellation or close. `text.ts` builds a bounded per-page text index, case- and whitespace-folded search, and match-to-text-item mapping. |
| Shared viewer | `src/ui/pdf/PdfViewer.tsx`, `pdfPages.ts`, `pdf.css` | One React component serves standalone, VS Code and the export preview. `PdfPages` renders only pages near the viewport with an `IntersectionObserver`, at most two concurrent renders, a per-canvas pixel budget and an LRU of six off-screen rendered pages. Pages outside that set release their canvases, cancel tasks and call `page.cleanup()`. The selectable pdf.js text layer sits over each canvas. Search highlights use the CSS Custom Highlight API so no text nodes are rewritten. Annotation and form layers are never created. |
| Standalone | `src/App.tsx`, `src/editor/useDocument.ts`, `src/ui/pdf/usePdfOriginal.ts`, `src/document/formats/registry.ts` | File picker and drop route `.pdf` through the registry. The import inspects the PDF before committing the summary, draft and original blob in one IndexedDB transaction. PDF tabs render the viewer in place of the editors. Rename, duplicate, delete, Trash restore and reload use the existing library. Automatic and manual versions are skipped and `recordVersion` refuses PDF content. **Download original** returns the stored bytes. |
| VS Code viewer | `extension/src/pdfEditor.ts`, `src/host/vscode/PdfWorkspace.tsx`, `src/host/vscode/protocol.ts` | `folio.pdf` is an optional `CustomReadonlyEditorProvider`. It reads local trusted `file:` documents with the existing bounded reader and sends a copy of the bytes to the webview. A file watcher and focus check compare SHA-256 and show a reload or deletion banner. Reload rereads and validates. The provider performs no workspace writes and has no dirty state, Save, backup or edit events. The webview's PDF shell does not create a native-text bridge or recovery journal. |
| Export model | `src/document/pdfExport/model.ts`, `fromMarkdown.ts`, `fromText.ts` | A paginated print model with headings, inline runs, lists, task items, quotes and callouts, code, literal text, tables with spans, images and rules, plus fidelity notices. Markdown is read from Folio's rendered ProseMirror tree, which is parsed from the captured source, so HTML-encoded images, callouts, diagrams and math follow the Visual editor. DOCX uses the Phase 7B structured model directly. TXT is a single literal block. |
| Layout and generation | `layout.ts`, `render.ts`, `generator.worker.ts`, `fonts.ts`, `coverage.ts` | `layoutPdf` converts the print model to a pdfmake definition. It handles glyph fallback, fixed-column TXT and code wrapping, table spans, image fitting and page numbers. Generation runs in an inline worker with a 90-second limit and is cancelled by terminating the worker. |
| Validation and review | `validate.ts`, `browser.ts`, `src/ui/PdfExportDialog.tsx` | Folio reopens every generated PDF with the viewer engine. It checks the page count, first-page dimensions against the selected options, and that every exported text fragment appears in reading order (page-number footers excluded). Validation failures are reported and nothing is delivered. The dialog shows options, the fidelity review and the validated PDF in the shared viewer, and binds delivery to the captured revision. |
| Delivery | `src/App.tsx`, `src/host/vscode/pdfCopy.ts`, `extension/src/pdfCopy.ts`, `extension/src/newFile.ts` | Standalone uses the existing download path. VS Code sends the reviewed bytes and native revision to the extension host. The host rechecks the revision, opens VS Code's save dialog, rechecks the revision again and creates the destination with `O_CREAT | O_EXCL` (`fs.open(path, 'wx')`), so an existing file is never replaced. It flushes the file, reads it back and compares SHA-256. A partial file it created is removed. |

## Security and resource limits

Every PDF is treated as untrusted. pdf.js runs in a dedicated worker. Folio does not load pdf.js's scripting sandbox, does not render the annotation or form layers, and does not create links. Document JavaScript, open actions, URI and launch actions, form submission and attachments therefore have no effect. Detected scripts, forms, attachments and signatures are disclosed above the pages. Password-protected PDFs are rejected with an explanation. PDFs with permission-only encryption open read-only with a notice. The VS Code webview keeps its existing CSP and Workspace Trust gate. The standalone build makes no network requests for PDF work.

| Limit | Value | Basis |
| --- | --- | --- |
| Input size | 64 MiB for standalone import, VS Code viewing and webview transfer | Sized for typical scanned reports. IndexedDB stores one immutable copy, and the webview receives one transferable copy. |
| Pages | 2,000 | A 2,000-page, 757 KB fixture opened in 1.03 s in Chromium 159 with three page canvases alive and a 58 MB JS heap. |
| Embedded image size | 40 megapixels (`maxImageSize`) | Limits decode memory to about 160 MB RGBA per image. Larger images are skipped by the renderer. |
| Canvas | 16,777,216 device pixels per page (`canvasMaxAreaInBytes` = 64 MiB) | High zooms lower the output scale instead of allocating larger canvases. |
| Concurrent renders and retention | 2 renders, 6 off-screen rendered pages | Bounded rendering work and canvas memory while scrolling large documents. |
| Text extraction | 200,000 characters per page, 8,000,000 per document, 20 s per page | Search reports truncation with a `+`. Extraction is lazy and cancellable. |
| Open time | 30 s | Malformed or pathological files stop with an error and the worker is destroyed. |
| Zoom | 25%–400%, plus fit width and fit page | Steps: 25, 50, 75, 100, 125, 150, 200, 300 and 400%. |
| Search results | 10,000 matches | Further matches are counted as `10,000+`. |
| Export | 4,000,000 characters, 60,000 blocks, 3,000 pages, 200 images (8 MiB each, 48 MiB total), 60 diagrams, 128 MiB output, 90 s generation | A 1,004,999-character TXT exported to 307 validated pages in 3.6 s. A 247,559-character Markdown file with 2,000 headings, links and tables exported to 364 pages in 21.6 s. |

Browsers do not expose per-worker memory limits. Folio bounds the inputs that drive memory and terminates its workers on close, cancellation and timeout. Worker memory under adversarial PDFs is not otherwise qualified.

## Viewer behavior

- Use **Previous page**, **Next page**, the page number field, PageUp/PageDown, Home/End and the arrow keys when the page area has focus. The toolbar shows the current page and total.
- Zoom with the toolbar, the zoom list, Ctrl/Cmd + `=` and `-`, and Ctrl/Cmd + `0` for fit width. Fit modes follow viewer resizes.
- **Find in PDF** (Ctrl/Cmd+F) searches embedded text across all pages, ignoring case and whitespace differences. It shows the active match and total, moves with Enter, Shift+Enter, F3 and the arrow buttons, and highlights the active match on its page. Matches can span text items. Folio does not claim complete fidelity for PDFs with unusual reading order, missing glyph mappings or incomplete Unicode data.
- Pages without embedded text show **No searchable text on this page**. If no page has text, search states that words shown only in images cannot be found instead of reporting zero matches. Partially image-only documents state how many pages were not searched. OCR is not performed.
- Native selection on the text layer copies text, and the copy handler normalizes it to NFC. **Copy page text** copies the extracted text of the current page. In VS Code both paths go through `vscode.env.clipboard`.

## Export fidelity

| Source | Preserved | Approximated or omitted, always disclosed in the review |
| --- | --- | --- |
| Markdown | Headings, paragraphs and alignment, bold, italic, underline, strikethrough, inline code, safe http(s), mailto and tel links, nested bullet, ordered and task lists, blockquotes, callouts with labels, code blocks, tables including header rows, alignment and merged cells, rules, table of contents, local data-URL images, workspace images in VS Code, captions, and Mermaid diagrams rendered in export mode. | Math prints as TeX source. Diagrams that fail to render print as Mermaid source, and successful diagrams are raster images without selectable text. Remote images are never downloaded and become labelled placeholders. Raw HTML and preserved syntax print as literal source. Heading, file and other unsupported links print as text. Front matter is not printed. The PDF is untagged, so alt text is not embedded. |
| TXT | Literal text with no Markdown interpretation, Unicode within font coverage, blank lines, leading and trailing spaces, and pagination. | Monospaced typography. Lines wrap at a fixed column computed from the page width (77 columns on Letter with normal margins). Tabs expand to 8-column stops. |
| DOCX | Paragraphs, headings 1–6, bold, italic, underline, explicit breaks, single-level bullet and numbered lists with start numbers, safe links, and rectangular tables with a header row, all from the structured model. | Every non-preserved import issue is listed as kept only in the original DOCX. Folio's fonts, page size and margins replace Word layout, so pagination, styles, line breaks and fonts can differ. |
| All | Selected page size (Letter, A4), orientation and margins (0.5, 1 or 1.5 in), page numbers, document title metadata. | Characters outside both fonts, such as emoji and CJK, are counted with examples and appear as blank or placeholder glyphs. Bold or italic inline code uses the single bundled monospaced face. |

The source document is never modified. Changing an option regenerates and revalidates the preview. Delivery checks that the document ID, editor revision and (in VS Code) native revision still match the capture. A changed document requires **Review current revision**. Cancellation terminates the generator, leaving no download or file.

## Standalone and VS Code integration

- **Standalone** · **File → Open document** and drag-and-drop accept `.pdf`. Imports that fail validation, are encrypted or cannot be stored open nothing and leave the current tab intact. PDF tabs survive reload, can be renamed, duplicated, deleted and restored from Trash, and offer **Download original**. Markdown, TXT and DOCX tabs gain **Export → Export PDF…**, which downloads the validated copy.
- **VS Code** · **Reopen Editor With → Folio PDF Viewer** opens local PDFs in trusted workspaces. Folio shows an explanation instead of the viewer for non-`file:` providers, Remote, oversized and invalid files. Markdown, TXT and DOCX editors gain **Export → Export PDF…** with **Save PDF copy…**. Saving is supported only to a new local `.pdf` file. If you confirm replacement of an existing file in the save dialog, Folio still refuses and asks for a new name.

## Verification

See the [project handoff](PROJECT_HANDOFF.md#phase-8-verification) for commands, counts and environments.

## Open items

- macOS, Linux, Remote, virtual providers and browser-only VS Code are not qualified for the PDF viewer or for PDF copy saving.
- Independent-reader interoperability was checked with pypdf 7.1.1 (strict parsing and text extraction) and Windows' `Windows.Data.Pdf` engine (load and render every page). Word 365 automation stopped at its interactive PDF-conversion prompt, and Adobe Acrobat DC exposed no automation interface. Neither is qualified, and Chrome, Edge, Preview and LibreOffice were not checked.
- PDF accessibility tagging, embedded alt text, KaTeX vector math, Mermaid vector diagrams, CJK and emoji fonts are not implemented.
- Very large or adversarial PDFs beyond the measured fixtures, worker memory under hostile input, and screen-reader use of the text layer remain unqualified.
