# Folio Marketplace and release materials (prepared, not published)

This file holds the materials for a first public release. Nothing here has been uploaded, and publication needs the owner's explicit authorization. The extension's `README.md` is the Marketplace page body, and `CHANGELOG.md` is the release notes.

## Listing metadata

| Field | Value |
| --- | --- |
| Display name | Folio Markdown Editor |
| Short description (manifest `description`) | Opt-in editors for Markdown, plain text, Word documents and spreadsheets, plus a read-only PDF viewer. |
| Publisher | `smithja06` (manifest value; confirm the Marketplace publisher before publishing) |
| Version | 0.1.0 (assign the public version at publication) |
| License | MIT, with third-party notices |
| Suggested categories | Other, Visualization (only `Other` is in the manifest today) |
| Suggested keywords | markdown, wysiwyg, docx, xlsx, csv, pdf, spreadsheet, editor |
| Platform statement | Qualified on desktop VS Code 1.100.0, 1.147.0 and 1.148.0 on Windows 11 x64. Other platforms are not qualified. |
| Required disclosure | Folio is not a complete replacement for Microsoft Word, Microsoft Excel or Adobe Acrobat. PDF exports are untagged and not PDF/UA. |

## Short listing text

> Edit Markdown visually or as source, and open plain text, supported Word documents, Excel workbooks and CSV files in focused, local-first editors inside VS Code. View PDFs read-only and export reviewed PDF copies. VS Code's own editors stay the default. Open a file with Folio when you want it. Folio edits a documented subset of each format and is not a replacement for Word, Excel or Acrobat.

## Screenshots

These are captured by `tests/vscode/release.screens.ts` from synthetic documents in real VS Code 1.147.0. Each image is clipped to Folio's webview. No VS Code chrome, file paths, account names or personal documents appear.

| File | Shows | Theme |
| --- | --- | --- |
| `docs/media/screenshots/markdown-visual.png` | Markdown Visual: callout, checklist, table | Light |
| `docs/media/screenshots/markdown-split.png` | Markdown Split with source pane | Dark |
| `docs/media/screenshots/pdf-export-preview.png` | Export PDF dialog: fidelity review and validated preview | Light |
| `docs/media/screenshots/pdf-viewer.png` | Exported PDF in the read-only viewer | Dark |
| `docs/media/screenshots/docx-editor.png` | DOCX with heading, link, list and table | Light |
| `docs/media/screenshots/xlsx-editor.png` | XLSX with theme, currency formats, conditional formatting and formula suggestions | Light |
| `docs/media/screenshots/csv-editor.png` | CSV with leading-zero identifiers | Dark |

To regenerate them, build the extension, then run this in PowerShell:

```powershell
$env:FOLIO_SCREENSHOTS = '1'
npx playwright test --config playwright.vscode.config.ts --output test-results/screens
```

The Marketplace only shows images from public HTTPS URLs. The repository is private, so the extension README does not embed the screenshots. After authorization, add them to the README with public URLs, for example from the release page or a public docs location, and repackage.

## Source companion hosting plan (not executed)

The ELK corresponding-source archive must be publicly available beside each distributed VSIX before publication. Build it with `npm run source:companion`. The current local archive is `extension/dist/source-companion/folio-elk-source-companion.zip`, 22,222,039 bytes, SHA-256 `89178e378ae24a0f5bac605b5a45fef4eda716a1a057985c85166750ba6b7854`. It is built from VSIX worker `dist/webview/assets/elk-XV6XMXQE-CTwVByd_.js`, SHA-256 `73a7025f…53cdae61185`. Rebuild it whenever the VSIX is repackaged, because the worker's name can change.

Proposed URL structure, using a GitHub Release on a repository that is public at publication time:

```
https://github.com/<owner>/<public-repo>/releases/tag/v<version>
  folio-<version>.vsix
  folio-<version>.vsix.sha256
  folio-elk-source-companion-<version>.zip
  folio-elk-source-companion-<version>.zip.sha256
  SOURCE.md
https://github.com/<owner>/<public-repo>/releases/download/v<version>/folio-elk-source-companion-<version>.zip
```

`SOURCE.md` lists the archive's checksum and the packaged ELK worker hash. Keep the archive available for at least as long as that VSIX version is distributed. Release assets are immutable per tag.

Steps after authorization:

1. Decide where to host: a public repository release, or a separate public source-only repository if the main repository stays private.
2. Build the final VSIX and the companion from the same commit. The worker hash in `manifest.json` must equal the hash of the packaged `elk-*.js`.
3. Upload both with their `.sha256` files.
4. Replace the sentence "Before any public distribution, host that archive…" in `extension/THIRD_PARTY_NOTICES.md` with the durable URL. Repackage, then recheck the inventory and notices. The VSIX hash changes.
5. Then, and only then, publish the VSIX.
