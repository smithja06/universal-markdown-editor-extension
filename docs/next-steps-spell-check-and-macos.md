# Next steps: spell check and macOS support

Status: plan, November 27, 2026. Folio Universal Editor 1.0.0 is qualified on Windows 11 with VS Code 1.100 to 1.148. This plan covers the two features proposed next. Neither is started.

| | Spell check | macOS support |
| --- | --- | --- |
| Why | Expected in any document editor. Today there is no checking inside VS Code. | Many VS Code users are on macOS. Today macOS is "not qualified". |
| Size | Medium: roughly 2 focused sessions, most of it testing | Phase A small to medium. Phase B (native Save) medium to large. |
| Needs from the owner | Decisions below. No special hardware. | Access to a Mac for acceptance testing, and the decisions below |
| Recommended order | Second | Phase A first (cheap, mostly qualification). Phase B last. |

**Recommended sequence.**

1. macOS Phase A: run the existing suites on macOS in CI and fix what they find.
2. Spell check.
3. macOS Phase B: native Save on Mac.

Release each step as its own minor version (1.1.0, 1.2.0, …) through the tag workflow.

---

## Part 1: Spell check

### Step 0: Confirm the starting point (short probe)

The visual editor already sets `spellcheck="true"`, and in a normal browser Chromium underlines misspellings. VS Code is believed to turn Chromium's spell checker off for its windows and webviews, but this has not been tested.

- Probe in the desktop test harness: type a misspelled word in the Markdown and DOCX editors and check for the native underline and context-menu suggestions.
- If the native checker does work, the feature shrinks to settings and polish. The rest of this part assumes it does not.

### What users get

- A red wavy underline under misspelled words in:
  - Markdown Visual
  - DOCX
  - TXT
  - optionally Markdown Source
- Right-click on a word, or press Shift+F10 or the context-menu key, for:
  - up to 5 suggestions
  - **Add to dictionary**
  - **Ignore** (for this session)
- Settings: `folio.spellCheck.enabled` (default on) and `folio.spellCheck.language` (default `en-US`). There is also a toggle in **Appearance / Document properties**.
- A command **Folio: Next spelling issue** for keyboard and screen-reader users. The underline also needs a non-color cue in high contrast themes.

### What is never checked

- code blocks, inline code, math, Mermaid source and YAML front matter
- link and image targets, URLs, email addresses and file paths
- wiki-link targets
- words with digits, ALL-CAPS acronyms, and mixed-case identifiers such as `camelCase`
- spreadsheet formulas

Spreadsheet text cells are a later option.

### Design

| Part | Plan |
| --- | --- |
| Engine | A Hunspell-compatible checker in a Web Worker, so typing never waits. First candidate: `nspell` (MIT) with an `en-US` Hunspell dictionary from the SCOWL-based `dictionary-en` package. Confirm its exact license at implementation. Benchmark load time and suggestion speed against a WASM Hunspell build before choosing. |
| Size | About 0.5 to 1.5 MB more in the VSIX, depending on the engine and dictionary. It loads lazily, only when an editor opens with checking on. |
| Tokenizer | A shared word tokenizer that understands apostrophes (`don't`), hyphens and Unicode letters, and applies the skip rules above. Unit tested on its own. |
| Visual editors | A ProseMirror plugin adds decorations for misspelled ranges. Only changed text blocks are rechecked, visible ones first, and results are cached per word. The 2 MB Markdown benchmark document must stay responsive. |
| Source and TXT | A CodeMirror extension with the same worker, tokenizer and cache. Markdown Source skips syntax through the Lezer tree. |
| Context menu | Folio's own menu in the webview, which already has menus and dialogs. The browser default is suppressed only when the click lands on a flagged word. |
| User dictionary | Stored in VS Code `globalState` through the host bridge, so it is shared by all Folio editors and survives restarts, and in `localStorage` in the standalone app. Optionally also read `cSpell.words` and `cSpell.userWords` so words added in the popular Code Spell Checker extension are respected. |
| Languages | English (US) first. More dictionaries are a later, per-language addition. Each adds size and a license to record. |
| Notices | Add the engine and dictionary to `THIRD_PARTY_NOTICES.md` and the generated notices. The release workflow already checks the notices. |

### Tests

- **Unit:** tokenizer and skip rules, the cache, and user-dictionary storage.
- **Chromium:** underline appears; suggestion replaces the word; **Add to dictionary** clears it everywhere; code and links are not flagged; turning checking off removes all underlines.
- **Desktop VS Code:** the same in the Markdown, DOCX and TXT editors. The user dictionary persists across a window reload and is shared between two Folio editors. A large document stays responsive.
- **Acceptance checklist:** a short owner pass, including Word documents with real prose.

### Open decisions for the owner

1. Is spell check on by default? Recommended: yes.
2. English (US) only at first, or also English (UK)?
3. Respect Code Spell Checker's word lists? Recommended: yes, read-only.
4. Include spreadsheet text cells now or later? Recommended: later.

---

## Part 2: macOS support

### What already works in principle

Folio has no native binaries. The extension host code, the webviews, the IronCalc WebAssembly engine, pdf.js and the export code all run unchanged on macOS on Apple Silicon and Intel. The one VSIX that ships today installs on macOS, and the same VSIX would keep serving every platform. Keyboard handling already maps Ctrl to Cmd in most places, and the manifest's mode shortcuts have macOS variants.

### What is Windows-only today

| Area | Today | macOS work |
| --- | --- | --- |
| Native in-place Save (DOCX, XLSX, CSV grid) | Only on local fixed NTFS drives. `localVolume.ts` asks PowerShell about the drive, and `verifiedReplace.ts` uses a Windows exclusive-share lock. Elsewhere Folio keeps a recoverable draft and offers reviewed copies. | Phase A keeps reviewed copies on macOS, which is already the behavior. Phase B adds native Save (below). |
| Workspace image picker | "Browsing requires a local Windows workspace on a fixed NTFS drive." | Qualify local APFS volumes and enable browsing. |
| Path comparison | Paths are compared case-insensitively only on Windows (`verifiedReplace.ts`, `spreadsheetCopy.ts`, `resources.ts`). | macOS APFS volumes are usually case-insensitive and normalization-insensitive, for example `é` as one or two code points. Compare paths the way the volume does, or by file identity, and add tests with differently cased and NFD/NFC names. |
| Fonts | DOCX offers Aptos, Calibri and Cambria, and Word documents often use them. | These ship with Microsoft Office for Mac, not macOS. Check fallbacks and that Folio keeps the font name even when it displays a substitute. |
| Office checks | Excel and Word checks run through Windows COM (`excel-check.ps1`, `word-check.ps1`). | Optional AppleScript or JXA equivalents for Office for Mac. |
| Test harness | `desktop.ts` already knows the macOS VS Code path. Process cleanup uses `taskkill` on Windows only. The native Save tests use PowerShell to hold files open. | Make the suites platform-aware. Skip or replace the Windows-only Save tests, and add macOS fixtures. |

### Phase A: macOS editors with reviewed copies

1. **CI first.** Add a `macos-latest` job to CI for lint, unit tests, browser tests and the installed-VSIX runbook. GitHub's macOS runners have a desktop session, which gives automated macOS evidence without owning a Mac. Make it a pull-request check as well as a release gate.
2. **Fix what CI finds.** Likely areas:
   - case and Unicode path handling
   - Cmd shortcuts in menus and labels, including Cmd+] and Cmd+[ for indentation and Cmd+B, Cmd+I and Cmd+U in spreadsheets
   - clipboard in the PDF viewer
   - native menus and dialogs
3. **Follow the existing runbook.** "Native macOS and Linux desktops" in `docs/extension-qualification.md` already lists the manual checks: OS and volume recording, all editing modes, themes, VoiceOver, recovery and the picker.
4. **Image picker on local APFS.** Detect the volume with `statfs` and `diskutil info -plist`. Exclude:
   - network shares (SMB, NFS, AFP)
   - removable media
   - cloud-synced folders: iCloud Drive (`~/Library/Mobile Documents`) and File Provider folders such as `~/Library/CloudStorage`, where files can be placeholders that are not on disk yet
5. **Owner acceptance on a real Mac** with a short checklist. Record the macOS version, chip and VS Code version.
6. **Release notes and README.** "macOS 14 or later, Apple Silicon and Intel: all editors. DOCX, XLSX and CSV save through reviewed copies."

Size: about 1 to 2 sessions of fixes plus CI setup, and one owner test session on a Mac.

### Phase B: native Save on macOS

The Windows guarantee rests on a mandatory exclusive lock: no other app can open, rename or replace the file while Folio writes. macOS has no mandatory locks. `flock` and `O_EXLOCK` are advisory and only bind other apps that also use them. A macOS design needs its own threat model:

- **Writing strategy.** Write a temporary file in the same folder, `fsync` it, verify the fingerprint of the original just before the swap, then swap it in atomically. Prefer an atomic exchange that keeps the original file's identity and metadata (Finder tags, extended attributes, permissions). Node has no API for `renamex_np(RENAME_SWAP)`, so either find a safe alternative or accept a plain `rename` and document what it does not preserve.
- **Durability.** On macOS, `fsync` does not force the drive's cache to disk. `F_FULLFSYNC` does. Confirm whether Node and libuv use it for `fsync` on macOS and measure the cost.
- **Coordination with other apps.** Word and Excel for Mac use their own lock files (`~$name`). Detect them and refuse, as Folio does on Windows when another app holds the file.
- **Volumes.** Allow internal APFS and HFS+ volumes only. Exclude network, removable and cloud-synced folders, as in Phase A step 4.
- **Journal and recovery.** Reuse the existing save journal, `classifyJournal` and the fault-injection tests from `verifiedReplace.test.ts`, adapted to the swap strategy, including a killed writer.

Size: about 2 to 3 sessions including fault injection, plus owner testing. Until Phase B ships, macOS users get reviewed copies, which are safe and already work.

### Open decisions for the owner

1. Do you have regular access to a Mac, or should acceptance on a real Mac be borrowed or rented time? CI covers most automated checks.
2. Is native Save on macOS needed for the first macOS release, or are reviewed copies acceptable at first? Recommended: reviewed copies first.
3. Minimum macOS version to claim. Recommended: the versions VS Code itself supports, with acceptance on the current release.
4. Linux could follow the same Phase A path cheaply once macOS is done. Add it?

---

## How each feature ships

Each feature follows the 1.0.0 process:

1. Implement and test on a branch.
2. Run the local qualification, including the desktop suites.
3. Do an owner acceptance checklist round.
4. Merge to `main`.
5. Bump `extension/package.json`, add the `CHANGELOG.md` section and update the source-archive link in the notices.
6. Push the `v<version>` tag.

The release workflow then publishes to GitHub and the Marketplace.
