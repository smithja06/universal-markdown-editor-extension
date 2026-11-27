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

The Marketplace only shows images from public HTTPS URLs. The extension README does not embed the screenshots yet. The repository `smithja06/universal-markdown-editor-extension` is public (checked November 27, 2026, through the anonymous GitHub API), so the screenshots can use `raw.githubusercontent.com` URLs pinned to a release tag. Add them after authorization, then repackage.

## Source companion hosting plan (not executed)

The ELK corresponding-source archive must be publicly available beside each distributed VSIX before publication. Build it with `npm run source:companion`. The current local archive is `extension/dist/source-companion/folio-elk-source-companion.zip`, 22,222,039 bytes, SHA-256 `b70c071821988d93d71330b90ebb122f68d76125b35d97a090b300143f05eb53`. It is built from VSIX worker `dist/webview/assets/elk-XV6XMXQE-BeFJUSYP.js`, SHA-256 `e93f3694…295c3bcdf6a`. Rebuild it whenever the VSIX is repackaged, because the worker's name can change. Edits to any file under `extension/`, including the notices and the manifest, can change it, because the webview build's Tailwind pass scans that folder for class names.

Proposed URL structure, using a GitHub Release on the public repository:

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

Steps after authorization. The release URL is known before anything is uploaded, so the notices can name it first:

1. Choose the version and its tag, for example `v0.1.0`.
2. Replace the sentence "Before any public distribution, host that archive…" in `extension/THIRD_PARTY_NOTICES.md` with `https://github.com/smithja06/universal-markdown-editor-extension/releases/download/v<version>/folio-elk-source-companion-<version>.zip`. Commit.
3. From that commit, build the final VSIX, then the companion. The worker hash in `manifest.json` must equal the hash of the packaged `elk-*.js`.
4. Create the tag and the GitHub Release, and upload the VSIX, the companion, both `.sha256` files and `SOURCE.md`. Check that the companion URL downloads anonymously.
5. Then, and only then, publish the same VSIX to the Marketplace.

**Automation option.** A GitHub Actions workflow can run steps 3 and 4 whenever a `v*` tag is pushed. It would install dependencies, run the tests, `npm run package:extension` and `npm run source:companion`, check the worker hashes, and attach the files to the release. With a Marketplace token stored as a repository secret, it could also publish. Each release then gets its own matching archive, and earlier archives stay available under their own tags. Two cautions:

- The CI build differs from a local build only in zip timestamps, so the hashes recorded in these documents would be the CI ones.
- Publishing from CI needs the owner's explicit authorization and a token.
