# Folio Universal Editor: Marketplace and release materials

This file holds the materials for the 1.0.0 release. The owner authorized version 1.0.0, publisher `smithja06`, the display name Folio Universal Editor and an automatic GitHub Actions release. Nothing is released until the owner pushes the `v1.0.0` tag. The extension's `README.md` is the Marketplace page body, and `CHANGELOG.md` is the release notes.

## Listing metadata

| Field | Value |
| --- | --- |
| Display name | Folio Universal Editor |
| Short description (manifest `description`) | Opt-in editors for Markdown, plain text, Word documents and spreadsheets, plus a read-only PDF viewer. |
| Extension ID | `smithja06.folio-universal-editor`. Builds before 1.0.0 used `smithja06.folio-markdown-editor`. |
| Publisher | `smithja06` |
| Version | 1.0.0 |
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

## Source companion hosting and the release workflow

The ELK corresponding-source archive must be publicly available beside each distributed VSIX. Every release publishes it as a GitHub Release asset:

```
https://github.com/smithja06/universal-markdown-editor-extension/releases/tag/v<version>
  folio-<version>.vsix                          + .sha256
  folio-elk-source-companion-<version>.zip      + .sha256
  SOURCE.md
```

`extension/THIRD_PARTY_NOTICES.md` names the archive's permanent link for the version in `extension/package.json`, for 1.0.0 `…/releases/download/v1.0.0/folio-elk-source-companion-1.0.0.zip`. Release assets stay under their tag, so each version keeps its own archive.

**Workflow** (`.github/workflows/release.yml`). It runs when a `v*` tag is pushed and has two jobs.

1. **release**, on `windows-latest`:
   - installs dependencies and runs lint, both type checks, the unit tests and the Chromium suite
   - builds the VSIX, then the companion
   - runs `scripts/release-assets.mjs`, which refuses to continue unless:
     - the tag equals `v` + the manifest version
     - the packaged notices name this version's archive URL
     - the companion's `manifest.json` records the exact ELK chunk inside the VSIX
   - creates the GitHub Release with the files, `SOURCE.md` and notes from `CHANGELOG.md`
   - downloads the archive without credentials to prove the link works
2. **publish**, in the `marketplace` environment: publishes that same VSIX with `vsce`, using the `VSCE_PAT` secret. Without the secret it stops with an error after the GitHub Release already exists. Required reviewers on the environment make each publish wait for approval.

The desktop VS Code suites need real VS Code windows. They stay a local qualification step before tagging. The CI-built VSIX has the same entries as a local build, and only zip timestamps differ.

**One-time setup by the owner.**

1. On https://marketplace.visualstudio.com/manage, sign in and make sure a publisher with ID `smithja06` exists. Create it if needed.
2. On https://dev.azure.com, open **User settings → Personal access tokens → New token**. Choose **Organization: All accessible organizations** and **Scopes: Custom defined → Marketplace → Manage**. Copy the token.
3. In the GitHub repository, open **Settings → Environments → New environment** and name it `marketplace`. Optionally add yourself under **Required reviewers**. Add an environment secret named `VSCE_PAT` with the token.

**Releasing a version.**

1. Bump `version` in `extension/package.json` and add a `## <version>` section to `extension/CHANGELOG.md`.
2. Update the archive link in `extension/THIRD_PARTY_NOTICES.md` to the new tag.
3. Run the local qualification, including the desktop suites, then merge to `main`.
4. On `main`, run `git tag v<version>` and `git push origin v<version>`.
5. Watch the **Actions** tab. If required reviewers are set, approve the `publish` job.

If a release fails before the GitHub Release exists, fix the cause, delete the tag locally and remotely, and push it again. If it fails after the release exists, either delete the release and tag and push the tag again, or rerun only the `publish` job.
