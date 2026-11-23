# Folio Phase 6 extension benchmarks

## Milestone 2.4 continuation

The continuation reran the preparation workload on Windows 11 Pro 25H2 x64 (26200.9974), VS Code 1.147.0, and Node 24.13.0. Each of the three fresh profiles opened a 5,000,000-byte document in Source and typed 384 keys at a target cadence of 75 ms. Each run recorded 384 browser journals and 384 host checkpoint replies, zero storage failures, and byte-exact autosave.

| 5 MB Source measurement | 2.3 median | 2.4 preparation median | 2.4 continuation median | Continuation runs |
| --- | ---: | ---: | ---: | ---: |
| Typing p95 (ms) | 40.88 | 42.13 | 47.10 | 47.10 / 45.43 / 93.10 |
| Checkpoint creation p95 (ms) | 25.10 | 26.00 | 29.40 | 29.40 / 28.00 / 66.20 |
| Host checkpoint acknowledgement p95 (ms) | 19.50 | 20.20 | 22.30 | 22.30 / 21.90 / 2,864.80 |
| Initial Visual ready (s) | 3.11 | 3.60 | 3.35 | 3.33 / 3.35 / 3.48 |
| Switch to Source (s) | 0.68 | 0.17 | 0.78 | 0.78 / 0.72 / 1.42 |
| Exact autosave (s) | 1.17 | 1.18 | 1.22 | 1.19 / 1.22 / 1.25 |

The third run exceeded the 2 s checkpoint acknowledgement threshold. Host handling reached 17.39 ms p95 and reply delivery reached 2,859 ms p95 in that run. The median of the three runs stayed below every investigation threshold. The comparison uses historical sessions from the same benchmark and does not isolate the cause of timing differences. It measures typing and draft recovery, with the image dialog closed and automatic uploads disabled.

The disposal run passed all 16 two-view cycles and found zero remaining webview iframes after each close. The workbench and extension-host JS heap samples were collected after garbage collection.

| Measurement (MiB) | 2.4 preparation warm → 16 cycles | Continuation warm | Cycle 4 | Cycle 8 | Cycle 12 | Cycle 16 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Extension-host JS heap | 49.84 → 50.45 | 49.63 | 50.14 | 50.22 | 50.24 | 50.25 |
| Extension-host RSS | 223.63 → 225.32 | 223.79 | 224.49 | 225.02 | 224.97 | 223.52 |
| Workbench renderer JS heap | 67.52 → 70.59 | 67.15 | 69.29 | 69.98 | 70.37 | 70.59 |

From cycle 12 to 16, extension-host JS heap grew by 0.01 MiB and workbench JS heap grew by 0.22 MiB. The probe samples short-lived view disposal, with long-running retention and separate webview renderer heaps outside its coverage. Reproduce both workloads using the [handoff commands](PROJECT_HANDOFF.md#verification).

## Milestone 2.4 preparation

The Windows 11 Pro 25H2 x64 (26200.9974) run used VS Code 1.147.0 and Node 24.13.0. It reused the harness below with three fresh profiles, 5,000,000-byte Markdown Source documents, 384 keys per run, and a 75 ms target cadence. Each run recorded 384 browser journals and 384 host replies, zero storage failures, and byte-exact autosave. The 2.3 column uses the earlier recorded runs. This is a cross-session comparison against historical results.

| 5 MB Source measurement | 2.3 median of three | 2.4 median of three |
| --- | ---: | ---: |
| Typing p95 | 40.88 ms | 42.13 ms |
| Checkpoint creation p95 | 25.10 ms | 26.00 ms |
| Host checkpoint acknowledgement p95 | 19.50 ms | 20.20 ms |
| Initial Visual ready | 3.11 s | 3.60 s |
| Switch to Source | 0.68 s | 0.17 s |
| Exact autosave | 1.17 s | 1.18 s |

The 2.4 range was 41.15–54.22 ms for typing p95, 25.30–32.50 ms for checkpoint creation p95, and 19.90–26.90 ms for acknowledgement p95. All observations stayed below the investigation thresholds. This workload measures the editor and draft recovery. The upload feature is disabled.

The repeated-view run passed all 16 disposal cycles with zero remaining webview iframes after each close. Each cycle opened a roughly 1 MB document in two views. The host JS heap and workbench heap were sampled after garbage collection, and RSS was recorded separately.

| Measurement (MiB) | 2.3 warm → 16 cycles | 2.4 warm → 16 cycles |
| --- | ---: | ---: |
| Extension-host JS heap | 49.63 → 50.21 | 49.84 → 50.45 |
| Extension-host RSS | 221.16 → 222.34 | 223.63 → 225.32 |
| Workbench renderer JS heap | 68.06 → 70.62 | 67.52 → 70.59 |

From cycle 12 to 16, the 2.4 host JS heap grew by 0.04 MiB and the workbench JS heap grew by 0.16 MiB. This run samples short-lived view disposal. Long-running retention and separate webview renderer heaps remain unmeasured.

## Milestone 2.3 qualification

Windows 11 Pro 25H2 x64 (26200.9974), VS Code 1.147.0, AMD Ryzen AI 9 HX 370, and Node 24.13.0. The latest Milestone 2.2 checkpoint (`95018b5`) and the 2.3 build each ran three fresh profiles in the existing 384-key, 75 ms, 5 MB Markdown Source workload. Each run recorded 384 browser journals, 384 host replies, zero failures in both stores, and exact autosave. The product source and lockfile were unchanged. The Windows worktrees differed in checkout line endings, which changed some generated bundle hashes. Baseline dependency setup overlapped early baseline samples, so use the medians and ranges as regression evidence rather than attributing the timing differences to product changes.

| 5 MB Source measurement | 2.2 median of three | 2.3 median of three |
| --- | ---: | ---: |
| Typing p95 | 55.96 ms | 40.88 ms |
| Checkpoint creation p95 | 38.30 ms | 25.10 ms |
| Host checkpoint acknowledgement p95 | 32.00 ms | 19.50 ms |
| Initial Visual ready | 3.28 s | 3.11 s |
| Switch to Source | 0.70 s | 0.68 s |
| Exact autosave | 1.20 s | 1.17 s |

The 5 MB Source typing p95 range was 41.62–63.74 ms in 2.2 and 40.09–41.74 ms in 2.3. The host acknowledgement p95 range was 20.30–82.90 ms and 19.50–19.90 ms. All samples were below the investigation thresholds. The 16-key 5 MB Split smoke run reached 101.11 ms typing p95, 900.40 ms checkpoint acknowledgement p95, 3.17 s startup, and 1.48 s for the switch. The recorded 2.2 comparison was 89.93 ms, 1,032.40 ms, 3.24 s, and 1.47 s. The 2.3 Split run autosaved exactly. Most of its acknowledgement tail followed the host reply, with 891 ms delivery p95 and 13.71 ms host handler p95.

The paired 64-key unpaced 2 MB Source replay captured all checkpoint replies in both builds. Typing p95 was 40.49 → 41.07 ms and checkpoint acknowledgement p95 was 199.60 → 191.80 ms, below its 3 s investigation threshold. The burst measures in-memory synchronization. Exact disk autosave is covered by the sustained cases.

### Repeated view disposal

Each revision ran in a fresh profile. After one warm-up cycle, the harness opened each of 16 distinct approximately 1 MB Markdown files in two Visual views, verified both views rendered, and closed them before moving to the next document. Each cycle required zero remaining webview iframes. The sample after every four cycles collects extension-host JS heap after garbage collection, host RSS, and the VS Code workbench renderer's JS heap after a CDP garbage collection.

| Measurement (MiB) | 2.2 warm → 16 cycles | 2.3 warm → 16 cycles |
| --- | ---: | ---: |
| Extension-host JS heap | 49.66 → 50.24 | 49.63 → 50.21 |
| Extension-host RSS | 221.97 → 222.46 | 221.16 → 222.34 |
| Workbench renderer JS heap | 67.52 → 70.62 | 68.06 → 70.62 |

Growth slowed in both runs. From cycle 12 to 16, host JS heap changed by 0.01 MiB in 2.2 and 0.00 MiB in 2.3. Workbench JS heap rose by 0.16 MiB and 0.19 MiB. This probe covers view open and disposal without edits. Separate webview renderer heaps and long-running native memory retention remain unmeasured. Investigate sustained post-GC growth across multiple comparable profiles. The Windows [recovery suite](extension-readiness.md#milestone-23-qualification) separately exercises pending edits, real local host restart, window reload, and provider outages.

```powershell
npm run build:extension
$env:FOLIO_BENCHMARK = '1'
$env:FOLIO_BENCHMARK_LONG = '1'
npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g 'sustained Markdown Source at 5000000 bytes' --repeat-each=3
Remove-Item Env:FOLIO_BENCHMARK_LONG
npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g 'sustained Split Editor at 5000000 bytes'
npx playwright test --config playwright.vscode.config.ts typing.bench.ts -g 'at 2000000 bytes'
npx playwright test --config playwright.vscode.config.ts retention.bench.ts
Remove-Item Env:FOLIO_BENCHMARK
```

Set `FOLIO_BENCHMARK_BUILD` to the earlier build's `extension/dist` to compare it using the same fixture bridge. Clear it before measuring the current build.

## Milestone 2.2 compared with Milestone 2.1

Both builds used Windows 11 Pro 25H2 x64 (26200.9974), desktop VS Code 1.147.0 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`), an AMD Ryzen AI 9 HX 370, Node 24.13.0, and one Playwright worker. The reference build came from the approved `06d1c50` checkpoint. Each case used a fresh VS Code profile and the same 75 ms target input cadence and fixture sizes as the historical method below. Each build ran 15 paced cases and four unpaced Source cases. All 30 paced cases had one browser journal write and one host checkpoint reply per key, zero storage failures, and an exact autosave. The 2.2 harness asserts both counts.

| Size (MB) | Mode | Typing p95 (ms) | Checkpoint creation p95 (ms) | Checkpoint reply p95 (ms) | Initial Visual ready (s) | Mode switch (s) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 0.1 | Source | 11.09 → 9.03 | 3.50 → 3.10 | 7.70 → 8.50 | 1.16 → 0.99 | 0.42 → 0.19 |
| 0.1 | Visual | 14.47 → 9.27 | 4.50 → 3.20 | 11.70 → 8.80 | 2.19 → 1.02 | — |
| 0.1 | Split | 15.21 → 9.79 | 5.20 → 3.40 | 12.60 → 9.10 | 2.05 → 0.94 | 0.45 → 0.20 |
| 0.5 | Source | 21.10 → 10.96 | 9.00 → 4.50 | 13.10 → 8.20 | 2.44 → 1.25 | 0.51 → 0.18 |
| 0.5 | Visual | 28.67 → 13.07 | 15.00 → 6.30 | 21.90 → 32.70 | 2.39 → 1.22 | — |
| 0.5 | Split | 33.92 → 12.97 | 18.00 → 6.60 | 29.40 → 27.50 | 2.43 → 1.27 | 0.72 → 0.41 |
| 1 | Source | 38.86 → 15.38 | 20.40 → 8.00 | 23.50 → 9.70 | 2.88 → 1.48 | 0.63 → 0.12 |
| 1 | Visual | 45.72 → 22.64 | 25.20 → 13.60 | 36.70 → 54.00 | 2.82 → 1.41 | — |
| 1 | Split | 55.83 → 21.53 | 33.20 → 12.40 | 52.50 → 18.10 | 2.74 → 1.52 | 0.85 → 0.53 |
| 2 | Source | 61.14 → 38.46 | 35.50 → 21.30 | 39.20 → 20.70 | 4.17 → 2.02 | 1.36 → 0.50 |
| 2 | Visual | 75.97 → 32.72 | 56.50 → 21.10 | 298.30 → 27.60 | 3.78 → 2.04 | — |
| 2 | Split | 91.27 → 35.50 | 60.70 → 24.60 | 194.70 → 31.40 | 3.98 → 1.75 | 1.58 → 0.71 |
| 5 | Source | 91.32 → 44.11 | 62.70 → 26.30 | 650.00 → 21.50 | 6.81 → 3.09 | 1.40 → 0.67 |
| 5 | Visual | 201.90 → 87.12 | 116.90 → 61.90 | 2555.00 → 512.50 | 6.82 → 3.20 | — |
| 5 | Split | 200.91 → 89.93 | 120.70 → 63.20 | 2658.00 → 1032.40 | 6.75 → 3.24 | 5.04 → 1.47 |

Source input now reuses the string already produced by CodeMirror for the transaction. A fresh Visual view computes its document statistics once. Visual-to-Source synchronization reuses the replacement operation's change check. The benchmark still opens a full Markdown parse and Visual document and initializes CodeMirror for the source pane. Split adds preview synchronization and scroll mapping. The browser still serializes the full recovery snapshot and the host receives every checkpoint. At 5 MB Source, p95 for the browser storage call itself was 15.1 → 7.8 ms with the same storage code, illustrating the load variance between the two full matrices. The matrix measures the observed end-to-end result and cannot attribute the whole change to Folio.

Each unpaced Source case recorded all 64 checkpoint replies in both builds.

| Size (MB) | Typing p95 (ms) | Checkpoint reply p95 (ms) | Host handler p95 (ms) | Host reply delivery p95 (ms) |
| ---: | ---: | ---: | ---: | ---: |
| 0.1 | 17.82 → 8.81 | 47.80 → 27.10 | 14.71 → 9.38 | 45 → 23 |
| 0.5 | 20.62 → 13.55 | 78.60 → 115.40 | 14.30 → 16.14 | 71 → 36 |
| 1 | 44.47 → 33.05 | 573.50 → 185.60 | 15.01 → 9.17 | 566 → 182 |
| 2 | 66.15 → 40.46 | 1414.10 → 528.60 | 12.93 → 13.25 | 1411 → 528 |

At 5 MB Split in the paced matrix, host reply delivery p95 was 2638 → 1024 ms, with host handler p95 of 37.70 → 16.26 ms. The separately calculated stage percentiles describe distributions and cannot be added together. At 2 MB in the burst and 5 MB Split under paced input, most of the acknowledgement tail follows the host reply.

### Longer paired sessions

The longer run used 384 keys per case and added memory samples after keys 128 and 256. Each row ran for about 30–32 seconds, followed by the autosave probe. All eight runs passed, with 384 browser journal writes, 384 host replies, zero failures in either store, and exact autosave for each case.

```powershell
$env:FOLIO_BENCHMARK = '1'
$env:FOLIO_BENCHMARK_LONG = '1'
npx playwright test --config playwright.vscode.config.ts sustained.bench.ts --grep 'at 2000000 bytes|sustained Markdown Source at 5000000 bytes'
Remove-Item Env:FOLIO_BENCHMARK_LONG
Remove-Item Env:FOLIO_BENCHMARK
```

| Size (MB) | Mode | Typing p95 (ms) | Creation p95 (ms) | Checkpoint reply p95 (ms) | Initial Visual ready (s) | Mode switch (s) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 2 | Source | 38.63 → 20.44 | 21.70 → 11.60 | 21.10 → 10.60 | 1.91 → 1.88 | 0.61 → 0.56 |
| 2 | Visual | 64.36 → 37.83 | 44.50 → 24.20 | 157.50 → 30.40 | 2.22 → 2.03 | — |
| 2 | Split | 61.13 → 36.18 | 41.80 → 22.90 | 115.10 → 32.00 | 1.90 → 1.99 | 0.91 → 0.94 |
| 5 | Source | 87.56 → 54.11 | 57.80 → 36.00 | 529.70 → 29.80 | 3.32 → 3.30 | 2.41 → 0.70 |

The 5 MB Source typing and mode-switch improvements repeated. Its initial Visual startup was effectively flat in this pair, so the large startup improvement in the first matrix did not reproduce. Full parsing, DOM creation, and editor initialization remain on the startup path. At 5 MB Source, host reply delivery p95 was 517 → 26 ms, while handler p95 was 15.42 → 12.20 ms. Host CPU rose from 12.3% to 16.6% of one logical core as native edit acknowledgements increased from 183 to 379. Exact autosave was 1.19 → 1.22 s.

| Session | Webview JS heap in 2.1 (MiB) | Webview JS heap in 2.2 (MiB) | Final host RSS (MiB) | Final host JS heap (MiB) |
| --- | --- | --- | ---: | ---: |
| 2 MB Source | 38.4 / 37.7 / 38.6 / 62.8 | 41.1 / 123.7 / 115.9 / 84.4 | 306.3 → 295.0 | 83.7 → 94.4 |
| 2 MB Visual | 29.4 / 58.0 / 105.6 / 63.7 | 28.8 / 70.7 / 60.6 / 173.7 | 292.1 → 296.0 | 80.2 → 86.5 |
| 2 MB Split | 43.0 / 157.1 / 138.1 / 79.1 | 32.1 / 160.8 / 55.8 / 126.4 | 295.5 → 311.0 | 82.6 → 114.0 |
| 5 MB Source | 70.3 / 225.5 / 167.6 / 179.4 | 65.2 / 163.6 / 86.1 / 164.9 | 368.3 → 313.8 | 148.6 → 112.3 |

The four webview heap samples are before typing, after keys 128 and 256, and after queue drain. The 5 MB Source host RSS started at 287.9 → 284.8 MiB and ended at 368.3 → 313.8 MiB. Webview heap varied within each run. The 2 MB Visual and Split end snapshots were higher in 2.2, while the 5 MB Source end snapshot was lower. Neither garbage collection nor peak capture was controlled, and the run covers one active view for roughly half a minute. These snapshots justify longer profiling across repeated mode switches and multiple retained views if memory grows in use.

### Regression thresholds

On a comparable, idle desktop, repeat a timing threshold breach in three isolated profiles and use the median of those runs. Investigate 5 MB Source typing p95 over **110 ms**, checkpoint creation p95 over **75 ms**, Visual startup over **8 s**, a Source switch over **4 s**, or a Split switch over **6 s**. Investigate checkpoint acknowledgement p95 over **2 s** at paced 5 MB Source or **3 s** in the 2 MB Source burst. These are investigation thresholds for comparable runs. The strict harness checks are complete checkpoint delivery, zero failures in the two stores under normal test conditions, and exact autosaved content. Hardware-dependent timings belong in repeated comparison runs.

## Historical Milestone 2.1 comparison

## Method

The baseline is the Milestone 2 tree (`2ada555`). Both builds run on Windows 11 Pro x64 with desktop VS Code 1.147.0, an AMD Ryzen AI 9 HX 370, and one Playwright worker. Each case starts a fresh VS Code profile and opens an ASCII fixture with an ATX heading, paragraphs, emphasis, and workspace-relative Markdown links. Sizes are decimal bytes.

Startup timing starts at the command to open the file and ends when the initial Visual heading is visible. The Source and Split cases then time switching from Visual until the Source pane is editable. Split typing uses the Visual pane with CodeMirror mounted. Each key appends to the heading. Playwright aims for one key every 75 ms and waits for input processing when a key takes longer. Source and 100 KB cases use 128 keys. Visual and Split use 48 keys at 500 KB, 32 at 1 and 2 MB, and 16 at 5 MB. Every case waits for native synchronization and outstanding host checkpoint replies. The autosave probe sets VS Code's one-second `afterDelay` policy, types one more key, and compares the saved file byte for byte with the intended text.

Percentiles use the nearest rank. Input time is the Playwright keyboard round trip. Checkpoint creation is measured from `beforeinput` to the checkpoint post, including editor work, snapshot serialization, and the synchronous browser journal write. Browser storage time covers `localStorage.setItem` alone. Host backup time starts at the checkpoint post and ends when the browser receives its reply. The staged host probe separately times host entry through the VS Code storage API response. Local wall-clock timestamps separate submission-to-host ingress from host reply-to-webview delivery. These timings have millisecond precision. The storage promise indicates workbench acceptance and does not measure a disk flush. [VS Code Memento implementation](https://github.com/microsoft/vscode/blob/8a14f0cc1b08d531eb83255ea3764ae22aa932b5/src/vs/workbench/api/common/extHostMemento.ts) [Workbench storage RPC](https://github.com/microsoft/vscode/blob/8a14f0cc1b08d531eb83255ea3764ae22aa932b5/src/vs/workbench/api/browser/mainThreadStorage.ts)

CPU is extension-host user plus system time divided by elapsed time through queue drain, as a percentage of one logical core. This includes the desktop test bridge. RSS and JavaScript heap are snapshots before and after typing. Browser heap uses Chromium's `performance.memory`. These measurements depend on garbage collection and do not measure peak memory, retention over a long editing session, or renderer CPU.

```powershell
npm run build:extension
$env:FOLIO_BENCHMARK = '1'
npx playwright test --config playwright.vscode.config.ts sustained.bench.ts
npx playwright test --config playwright.vscode.config.ts typing.bench.ts -g 'at 2000000 bytes'
$env:FOLIO_BENCHMARK_LONG = '1'
npx playwright test --config playwright.vscode.config.ts sustained.bench.ts -g 'at 2000000 bytes'
Remove-Item Env:FOLIO_BENCHMARK_LONG
Remove-Item Env:FOLIO_BENCHMARK
```

To compare an earlier revision with the same harness, build that revision separately and point `FOLIO_BENCHMARK_BUILD` to its `extension/dist` directory while running Playwright. Only the copied test extension receives the timing probes.

## The 2 MB acknowledgement regression

The original 64-key Source burst reported host acknowledgement p95 rising from 718 to 1,417.5 ms. The instrumented replay warmed up Source, positioned at the end, and issued the same 64 keys as soon as the preceding keyboard call returned without waiting for a native edit acknowledgement. The Milestone 1.1 tree (`e1d2f58`) and Milestone 2 each ran in an isolated window with the same probe. This reproduced the regression direction and located the delay after the host replied. Milestone 2 reduced checkpoint transport and host storage costs, but the renderer took longer to deliver the reply to Folio while input continued. An earlier repeat of the Milestone 2 burst reached 487.4 ms p95, so the exact tail varies with scheduling.

At Milestone 2, measured p95 for this burst was 0.3 ms to submit the compact message, 1 ms from submission to entry at the host, 12.36 ms inside the host, and 1,252 ms from the host reply to its webview listener. Milestone 1.1's full checkpoints took 5.6, 91, 79.62, and 504 ms respectively. These are separate percentile distributions. Compact backups reduced host CPU as intended. In the paced 2 MB Source case, the Milestone 2 delivery p95 was 12 ms. The same build reached 15.76 s in the 2 MB Visual case, where the webview also reparsed the document for each edit.

| 2 MB Source burst | Typing p50 / p95 (ms) | Checkpoint acknowledgement p50 / p95 (ms) | Host CPU (ms) | Δ Host RSS / heap (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Milestone 1.1 | 42.76 / 70.44 | 427.60 / 609.70 | 2,001 | +98.0 / +48.6 |
| Milestone 2 | 38.55 / 67.32 | 786.00 / 1,254.60 | 329 | +18.7 / +20.1 |
| Milestone 2.1 | 41.86 / 67.61 | 969.30 / 1,702.80 | 485 | +8.0 / −12.7 |

The new build still shows a long reply tail in the unpaced Source burst. In that run, the host replied in 13.39 ms p95 and reply delivery took 1,701 ms p95. Sustained, paced input and maximum-rate input exercise different amounts of queue contention.

Milestone 2 sent the full native Markdown back on each accepted edit. Milestone 2.1 sends the edit identity and document metadata after verifying the exact native result, and reuses the already normalized text when the VS Code document version is unchanged. It also avoids the full Markdown parse for narrow, isolated plain-text Visual edits. Both changes reduce competition with checkpoint replies. Checkpoints still post immediately, and both recovery stores use the same formats and write cadence.

## Sustained typing and checkpoint results

Results show Milestone 2 → Milestone 2.1. Latencies are p50 / p95 in milliseconds.

| Size | Mode | Keys | Typing | Checkpoint creation | Checkpoint acknowledgement |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 KB | Source | 128 | 8.47 / 10.36 → 11.18 / 14.24 | 2.70 / 3.60 → 3.30 / 4.60 | 7.00 / 9.00 → 7.00 / 9.70 |
| 100 KB | Visual | 128 | 39.08 / 76.86 → 11.04 / 13.87 | 27.60 / 40.90 → 3.40 / 4.30 | 7.00 / 11.30 → 7.90 / 11.70 |
| 100 KB | Split | 128 | 40.52 / 96.19 → 11.77 / 13.80 | 27.50 / 39.30 → 3.90 / 4.90 | 8.50 / 43.70 → 8.50 / 11.80 |
| 500 KB | Source | 128 | 10.72 / 13.90 → 15.59 / 18.76 | 4.30 / 6.30 → 6.10 / 8.10 | 7.60 / 11.60 → 9.00 / 11.20 |
| 500 KB | Visual | 48 | 168.26 / 399.51 → 19.23 / 25.50 | 124.80 / 147.80 → 9.10 / 12.30 | 13.90 / 164.60 → 14.50 / 19.20 |
| 500 KB | Split | 48 | 138.30 / 548.84 → 20.63 / 25.42 | 125.30 / 151.30 → 9.90 / 11.70 | 857.50 / 2939.20 → 16.40 / 21.70 |
| 1 MB | Source | 128 | 14.17 / 16.40 → 25.12 / 31.82 | 6.80 / 8.60 → 12.40 / 16.00 | 7.50 / 9.60 → 14.40 / 19.70 |
| 1 MB | Visual | 32 | 262.41 / 290.88 → 34.80 / 42.52 | 253.60 / 282.00 → 20.30 / 25.20 | 4045.60 / 8023.50 → 25.90 / 32.10 |
| 1 MB | Split | 32 | 255.30 / 299.14 → 34.83 / 42.17 | 245.90 / 290.90 → 20.40 / 24.90 | 3941.00 / 7905.90 → 28.40 / 43.10 |
| 2 MB | Source | 128 | 20.33 / 23.41 → 39.56 / 47.81 | 11.30 / 13.80 → 22.30 / 25.70 | 9.90 / 12.20 → 20.90 / 28.50 |
| 2 MB | Visual | 32 | 517.39 / 572.92 → 60.48 / 90.05 | 505.80 / 551.60 → 40.30 / 54.00 | 7915.00 / 15773.40 → 86.80 / 153.20 |
| 2 MB | Split | 32 | 509.22 / 539.90 → 60.97 / 80.48 | 492.20 / 530.60 → 39.80 / 53.40 | 7768.90 / 15464.70 → 103.40 / 170.60 |
| 5 MB | Source | 128 | 39.02 / 51.50 → 70.72 / 95.52 | 28.40 / 38.70 → 53.80 / 66.40 | 28.40 / 41.40 → 254.20 / 498.80 |
| 5 MB | Visual | 16 | 1323.58 / 2614.28 → 137.51 / 169.22 | 1301.30 / 2581.10 → 99.10 / 107.20 | 15446.10 / 25902.90 → 1213.40 / 2225.60 |
| 5 MB | Split | 16 | 2635.18 / 2835.00 → 151.55 / 182.85 | 2547.50 / 2785.50 → 103.50 / 122.80 | 18764.60 / 39949.50 → 1525.90 / 2666.10 |

| Size | Mode | Browser storage p50 / p95 (ms) | Host handler p50 / p95 (ms) | Host reply delivery p95 (ms) | Native edit replies |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 KB | Source | 0.10 / 0.20 → 0.10 / 0.20 | 1.81 / 4.16 → 2.37 / 4.48 | 6 → 9 | 128 → 128 |
| 100 KB | Visual | 0.10 / 0.20 → 0.10 / 0.20 | 1.78 / 4.43 → 2.30 / 4.69 | 9 → 7 | 128 → 128 |
| 100 KB | Split | 0.10 / 0.20 → 0.10 / 0.20 | 1.83 / 6.80 → 2.35 / 3.41 | 40 → 8 | 127 → 128 |
| 500 KB | Source | 0.40 / 0.60 → 0.60 / 0.70 | 1.76 / 4.66 → 2.01 / 4.45 | 9 → 9 | 128 → 128 |
| 500 KB | Visual | 0.40 / 0.60 → 0.70 / 1.00 | 1.89 / 9.56 → 1.77 / 4.09 | 165 → 18 | 46 → 48 |
| 500 KB | Split | 0.40 / 0.60 → 0.70 / 0.80 | 1.60 / 13.45 → 1.94 / 5.49 | 2938 → 24 | 14 → 48 |
| 1 MB | Source | 1.40 / 1.80 → 2.60 / 3.30 | 2.08 / 4.12 → 2.16 / 7.40 | 7 → 16 | 128 → 128 |
| 1 MB | Visual | 1.50 / 1.90 → 2.80 / 3.20 | 2.49 / 17.13 → 1.92 / 7.82 | 8028 → 29 | 2 → 32 |
| 1 MB | Split | 1.40 / 2.10 → 2.80 / 3.20 | 3.06 / 14.75 → 2.17 / 9.28 | 7904 → 35 | 2 → 32 |
| 2 MB | Source | 2.50 / 3.30 → 4.60 / 5.60 | 3.01 / 6.32 → 1.90 / 12.20 | 12 → 22 | 128 → 128 |
| 2 MB | Visual | 2.40 / 3.40 → 4.70 / 5.50 | 3.63 / 16.14 → 2.73 / 11.94 | 15757 → 147 | 2 → 29 |
| 2 MB | Split | 2.40 / 3.00 → 4.70 / 5.50 | 3.13 / 16.24 → 3.28 / 12.98 | 15447 → 166 | 2 → 25 |
| 5 MB | Source | 7.20 / 9.30 → 11.80 / 13.80 | 7.98 / 16.75 → 5.17 / 16.81 | 31 → 486 | 128 → 43 |
| 5 MB | Visual | 6.90 / 14.50 → 12.10 / 13.50 | 5.75 / 18.14 → 6.19 / 23.25 | 25888 → 2201 | 2 → 2 |
| 5 MB | Split | 11.00 / 14.60 → 12.00 / 13.70 | 5.47 / 22.35 → 4.69 / 23.78 | 39932 → 2648 | 2 → 2 |

## Startup, autosave, CPU, and memory

The time column gives initial open / mode switch / autosave in seconds. The memory column gives start-to-finish changes in host RSS / host JavaScript heap / webview JavaScript heap in MiB. Negative values reflect lower end snapshots.

| Size | Mode | Open / switch / autosave (s) | Host CPU ms (% of one core) | Δ Host RSS / host heap / webview heap (MiB) |
| --- | --- | ---: | ---: | ---: |
| 100 KB | Source | 1.28 / 0.30 / 1.11 → 2.28 / 0.21 / 1.11 | 1468 (14.1%) → 1671 (15.9%) | 40.0 / 5.1 / 22.7 → 16.1 / 22.9 / 10.6 |
| 100 KB | Visual | 1.28 / — / 1.14 → 1.88 / — / 1.14 | 1890 (18.0%) → 1531 (14.4%) | 39.1 / 2.7 / 39.7 → 16.0 / 19.4 / 22.5 |
| 100 KB | Split | 1.06 / 0.21 / 1.14 → 1.99 / 0.34 / 1.11 | 1593 (14.8%) → 1578 (15.0%) | 35.7 / 1.2 / 35.7 → 14.0 / 17.6 / 12.4 |
| 500 KB | Source | 1.22 / 0.27 / 1.11 → 2.26 / 0.47 / 1.12 | 2031 (19.5%) → 1531 (14.5%) | 30.8 / 13.3 / 15.5 → 26.8 / 18.1 / 65.3 |
| 500 KB | Visual | 2.44 / — / 1.24 → 2.18 / — / 1.15 | 954 (10.3%) → 922 (23.8%) | 41.9 / 25.4 / 28.2 → 31.7 / 1.1 / 42.5 |
| 500 KB | Split | 1.63 / 1.05 / 1.22 → 2.43 / 0.63 / 1.13 | 655 (6.3%) → 672 (17.1%) | 6.9 / 3.2 / 70.1 → 30.8 / 12.2 / 44.3 |
| 1 MB | Source | 1.48 / 0.38 / 1.10 → 2.72 / 0.62 / 1.15 | 1828 (17.5%) → 1938 (18.3%) | 36.1 / 14.7 / 41.3 → 29.8 / 15.5 / 49.9 |
| 1 MB | Visual | 1.56 / — / 1.36 → 2.98 / — / 1.14 | 484 (5.6%) → 859 (31.6%) | 18.2 / 11.5 / 60.0 → 34.4 / 21.9 / 35.2 |
| 1 MB | Split | 1.55 / 0.56 / 1.36 → 2.99 / 1.10 / 1.13 | 548 (6.4%) → 656 (24.4%) | 18.5 / 7.5 / -2.0 → 31.4 / 21.7 / 57.3 |
| 2 MB | Source | 1.87 / 0.42 / 1.12 → 4.04 / 1.05 / 1.16 | 2047 (19.6%) → 1875 (17.6%) | 149.7 / 117.6 / 15.3 → 50.2 / 32.4 / -10.2 |
| 2 MB | Visual | 2.18 / — / 1.61 → 4.09 / — / 1.19 | 470 (2.8%) → 390 (14.4%) | 52.9 / 37.8 / 9.9 → 28.2 / 28.4 / 58.5 |
| 2 MB | Split | 1.96 / 0.79 / 1.63 → 4.14 / 1.56 / 1.18 | 796 (4.8%) → 422 (15.2%) | 4.1 / -14.2 / 138.6 → 28.1 / 13.3 / 25.1 |
| 5 MB | Source | 3.41 / 0.71 / 1.16 → 7.14 / 2.56 / 1.26 | 4047 (38.7%) → 1234 (11.4%) | 5.0 / -7.4 / 133.6 → 72.0 / 87.4 / 129.6 |
| 5 MB | Visual | 3.44 / — / 3.69 → 7.52 / — / 1.31 | 1328 (4.4%) → 312 (5.3%) | 6.6 / 1.2 / 126.5 → -5.7 / 16.0 / 93.4 |
| 5 MB | Split | 6.62 / 3.96 / 3.94 → 7.45 / 3.37 / 1.33 | 2484 (5.4%) → 672 (10.7%) | 45.2 / 23.1 / 70.2 → 44.4 / 16.3 / 134.0 |

## Large Source repeats and limits

The second paired run used the same workload and fresh profiles. The 2 MB paced typing p95 values were close across the paired repeat, and the native edit acknowledgement improved. The 5 MB Source checkpoint tail was worse in both comparisons. In the paired repeat, most of the tail followed the host reply even though the host handler p95 fell from 23.4 to 15.05 ms. The unpaced Source burst p95 changed in opposite directions across the two comparisons. The measurements support a reduction in native reply cost and a remaining scheduling bottleneck at maximum input rate.

| Repeat | Typing p50 / p95 (ms) | Checkpoint acknowledgement p50 / p95 (ms) | Native edit acknowledgement p95 (ms) | Host CPU (ms) |
| --- | ---: | ---: | ---: | ---: |
| 2 MB paced Source | 39.19 / 50.39 → 40.89 / 52.29 | 20.20 / 26.90 → 21.10 / 27.90 | 71.10 → 15.10 | 3,766 → 1,906 |
| 5 MB paced Source | 70.09 / 98.76 → 71.84 / 104.74 | 468.80 / 748.20 → 307.50 / 1,715.60 | 772.00 → 1,403.80 | 2,172 → 1,531 |
| 2 MB unpaced Source | 41.37 / 77.83 → 43.36 / 67.53 | 1,028.60 / 1,849.90 → 761.80 / 1,125.10 | 1,955.80 → 1,080.30 | 547 → 499 |

Both 15-case matrices and all paced Source repeats wrote the exact expected Markdown with autosave. No browser journal or host backup failures were observed in those fixtures. The webview still serializes the latest complete draft synchronously on each distinct generation. Its cost grows with the document, and storage quotas can leave only the host copy. The compact host record stays self-contained. There is no time-based coalescing that withholds a new generation when either storage channel is unavailable. Complex Visual edits and initial Visual load still parse the full document. At 5 MB, Visual and Split both remain visibly slower than smaller files. A first pass through the matrix is not a long-term memory-retention test.

## Longer 2 MB sessions

Milestone 2.1 also ran 384 keys per mode at the same target cadence. All three cases drained every checkpoint and autosaved the exact text. These sessions cover about half a minute each. The memory snapshots include garbage-collection effects and do not establish memory retention in longer sessions.

| Mode | Elapsed (s) | Typing p50 / p95 (ms) | Creation p50 / p95 (ms) | Checkpoint acknowledgement p50 / p95 (ms) | Host CPU (% of one core) | Δ Host RSS / host heap / webview heap (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Source | 31.57 | 40.60 / 48.84 | 22.80 / 28.50 | 21.30 / 26.40 | 19.1% | 46.3 / 24.0 / 33.1 |
| Visual | 31.59 | 61.14 / 84.62 | 40.00 / 48.40 | 80.40 / 164.20 | 15.0% | 17.8 / 25.5 / 83.0 |
| Split | 31.33 | 60.51 / 82.84 | 39.90 / 47.20 | 87.00 / 171.70 | 13.4% | 48.3 / 32.2 / 22.4 |

## Platform coverage

| Environment | Coverage |
| --- | --- |
| Windows 11 Pro x64, VS Code 1.147.0, local workspace | Native commands and shortcuts, light/dark/high-contrast themes, webview assets, images and links, precise edits and saves, rename and deletion, multiple views, and recovery after host interruption. |
| Windows desktop with a local root and a synthetic `folio-test-remote://test-server/project` provider | Provider-backed image and link resolution, multi-root path isolation, exact saved text, rename and deletion. The fixture runs through `vscode.workspace.fs` in a local extension host. |
| macOS and Linux desktops | Unverified. No machines or suitable environments were available. |
| Real VS Code Remote | Unverified. No SSH, WSL, Dev Container, or comparable remote workspace was available. |

Workspace attachment insertion still needs validation of writes and recovery in a real remote workspace, including out-of-root handling and failures around rename, reconnect, or interruption. Native keyboard and resource behavior also need macOS and Linux verification.

## Verification

- ESLint and TypeScript passed for the shared application and extension host. The standalone and extension production builds passed. The VSIX packaged successfully and its archive contained the manifest, extension host bundle, and webview entry.
- All 100 unit and integration tests and all 23 Windows desktop VS Code tests passed.
- All 60 standalone Chromium tests passed at 12 workers with the desktop and build jobs finished. An earlier concurrent run passed 59 of 60 and timed out in the offline HTML export test. Its trace showed roughly 22 seconds from export activation to the HTML download status, leaving little of the test's 30-second budget for the remaining downloads and offline assertions. The same test passed alone in 3.5 seconds and passed in the full rerun.
- The Windows restart suite recovered a 2.07 MB pending draft using only the host backup after killing the real extension host. It verified the complete recovery preview and copied BOM/CRLF bytes while the native buffer and disk retained their original content. Separate cases replayed stale storage and cleanup requests, recovered two views using different backup channels, and exercised Save, Undo, and Redo while an edit was pending.
- The two full benchmark matrices, the historical Source replay, the paired Source repeats, and the longer 2 MB sessions all completed. The autosave probes compared the actual file against the intended contents.
