// Builds the corresponding-source companion for the Eclipse-licensed ELK layout worker bundled through Mermaid.
// Every input is pinned by URL and SHA-256. A mismatch stops the build. The output is written only to
// extension/dist/source-companion and is never published by this script.
//
//   node scripts/elk-source-companion.mjs [--offline <directory with the downloaded inputs>]
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'extension', 'dist', 'source-companion')

// Versions come from the elkjs 0.12.1 Gradle recipe at commit 624ae90 and Folio's lockfile (mermaid 12.3.0 -> elkjs 0.12.1).
export const inputs = [
  { file: 'elkjs-624ae90aa37110033a8af59c5ccbb292708b4317.tar.gz', license: 'EPL-2.0 (selected)',
    role: 'elkjs wrappers, Gradle build recipe, GWT module, JavaScript API and published worker',
    url: 'https://codeload.github.com/kieler/elkjs/tar.gz/624ae90aa37110033a8af59c5ccbb292708b4317',
    sha256: 'ef323ac645876f9ea1c3392d691bc4c4b773c6231c5ffc6731dce78de5bcc469' },
  { file: 'elk-3aa3b9fb98d8f9a41285b3061cff5efe79ed2ba4.tar.gz', license: 'EPL-2.0 (selected)',
    role: 'ELK 0.12.1 Java, Xtend and MELK (.melk) sources compiled by elkjs, and the MELK generator plug-in source',
    url: 'https://codeload.github.com/eclipse-elk/elk/tar.gz/3aa3b9fb98d8f9a41285b3061cff5efe79ed2ba4',
    sha256: 'cee46035f0a691b0dd1813967b445b9fbf9385869bd280caf9574315f858f701' },
  { file: 'emf-common-2.12.4-sources.jar', license: 'EPL-1.0',
    role: 'EMF GWT Common runtime compiled into the worker',
    url: 'https://repo.maven.apache.org/maven2/com/genmymodel/emf/gwt/emf-common/2.12.4/emf-common-2.12.4-sources.jar',
    sha256: '8dfc4e97ca8eee5474927e2b0c5f3bdbd9a52dcd5dff8c0b433b1e938b843bbe' },
  { file: 'emf-ecore-2.12.4-sources.jar', license: 'EPL-1.0',
    role: 'EMF GWT Ecore runtime compiled into the worker',
    url: 'https://repo.maven.apache.org/maven2/com/genmymodel/emf/gwt/emf-ecore/2.12.4/emf-ecore-2.12.4-sources.jar',
    sha256: 'dd3b8c1c3bd0a27c1fbba908bcf0ff21a999148da4e68b3546bcde1dbce7b13a' },
  { file: 'org.eclipse.xtext.xbase.lib-2.36.0-sources.jar', license: 'EPL-2.0',
    role: 'Xtext Xbase runtime library compiled into the worker',
    url: 'https://repo.maven.apache.org/maven2/org/eclipse/xtext/org.eclipse.xtext.xbase.lib/2.36.0/org.eclipse.xtext.xbase.lib-2.36.0-sources.jar',
    sha256: '5e06e3cfc74663d11e0debe4cce88e1134d00eba8122b90712fccbb3a5f6754a' },
  { file: 'guava-gwt-31.1-jre-sources.jar', license: 'Apache-2.0',
    role: 'Guava GWT emulation compiled into the worker',
    url: 'https://repo.maven.apache.org/maven2/com/google/guava/guava-gwt/31.1-jre/guava-gwt-31.1-jre-sources.jar',
    sha256: 'd7e52f41ac6ea010787b5b3c8db7ffb54375d8d0c39c98c2badc9c38de7bf14b' },
  { file: 'gwt-user-2.13.0-sources.jar', license: 'Apache-2.0 (includes Unicode CLDR locale data)',
    role: 'GWT JRE emulation and i18n runtime compiled into the worker',
    url: 'https://repo.maven.apache.org/maven2/org/gwtproject/gwt-user/2.13.0/gwt-user-2.13.0-sources.jar',
    sha256: '3d306a865b59ece234e0e4acbb56f39ad14b4e79feec84d53caa3259bd7b1984' },
  { file: 'elkjs-0.12.1.tgz', license: 'EPL-2.0 (selected)',
    role: 'The published npm package Folio installs. Its lib/ files match commit 624ae90 byte for byte.',
    url: 'https://registry.npmjs.org/elkjs/-/elkjs-0.12.1.tgz',
    sha256: undefined },
]

const sha = bytes => createHash('sha256').update(bytes).digest('hex')

async function obtain(input, offline) {
  const bytes = offline ? new Uint8Array(await readFile(join(offline, input.file)))
    : new Uint8Array(await (await fetch(input.url, { redirect: 'follow' }).then(response => {
      if (!response.ok) throw new Error(`${input.url} returned ${response.status}`)
      return response
    })).arrayBuffer())
  const digest = sha(bytes)
  if (input.sha256 && digest !== input.sha256) throw new Error(`${input.file}: SHA-256 ${digest} does not match the pinned ${input.sha256}`)
  return { bytes, digest }
}

async function main() {
  const offline = process.argv.includes('--offline') ? resolve(process.argv[process.argv.indexOf('--offline') + 1]) : undefined
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  const elkjs = lock.packages['node_modules/elkjs']
  const mermaid = lock.packages['node_modules/mermaid']
  if (elkjs?.version !== '0.12.1' || !mermaid) throw new Error('The lockfile no longer resolves elkjs 0.12.1 through Mermaid. Re-audit before building the companion.')
  const npm = inputs.at(-1)
  // The npm integrity in the lockfile pins the registry tarball.
  npm.integrity = elkjs.integrity
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const files = {}
  const manifest = []
  for (const input of inputs) {
    const { bytes, digest } = await obtain(input, offline)
    if (input === npm) {
      const expected = Buffer.from(elkjs.integrity.replace(/^sha512-/, ''), 'base64').toString('hex')
      const actual = createHash('sha512').update(bytes).digest('hex')
      if (actual !== expected) throw new Error('elkjs-0.12.1.tgz does not match the lockfile integrity.')
    }
    files[`inputs/${input.file}`] = bytes
    manifest.push({ ...input, sha256: digest })
    process.stdout.write(`verified ${input.file} ${digest}\n`)
  }
  const worker = await readWebviewElkChunk()
  const readme = companionReadme(manifest, mermaid.version, worker)
  files['README.md'] = new TextEncoder().encode(readme)
  for (const license of ['EPL-1.0.txt', 'LICENSE']) files[`licenses/${license === 'LICENSE' ? 'Folio-MIT-LICENSE.txt' : license}`] = new Uint8Array(await readFile(join(root, 'extension', license)))
  files['licenses/EPL-2.0.txt'] = new Uint8Array(await readFile(join(root, 'extension', 'EPL-2.0.txt')))
  files['folio/package-lock.json'] = new Uint8Array(await readFile(join(root, 'package-lock.json')))
  files['folio/vite.webview.config.ts'] = new Uint8Array(await readFile(join(root, 'vite.webview.config.ts')))
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ worker, inputs: manifest }, null, 2) + '\n')
  const archive = zipSync(files, { level: 0, mtime: new Date('2026-01-01T00:00:00Z') })
  const target = join(output, 'folio-elk-source-companion.zip')
  await writeFile(target, archive)
  process.stdout.write(`wrote ${target} ${archive.byteLength} bytes sha256 ${sha(archive)}\n`)
}

async function readWebviewElkChunk() {
  const { readdir } = await import('node:fs/promises')
  const assets = join(root, 'extension', 'dist', 'webview', 'assets')
  const names = (await readdir(assets).catch(() => [])).filter(name => /^elk-.*\.js$/.test(name))
  if (names.length !== 1) return { file: null, sha256: null, note: 'Run npm run build:extension first to record the packaged ELK chunk.' }
  const bytes = await readFile(join(assets, names[0]))
  return { file: `dist/webview/assets/${names[0]}`, sha256: sha(bytes) }
}

function companionReadme(manifest, mermaidVersion, worker) {
  return `# Folio ELK source companion

Folio's VS Code extension and standalone build include Mermaid ${mermaidVersion}, which bundles the Eclipse Layout Kernel
JavaScript build elkjs 0.12.1. That worker is compiled with GWT from the Java, Xtend and MELK sources below. This archive
provides the corresponding source code for those Eclipse-licensed components, as required by the Eclipse Public
License 2.0 §3.1 (elkjs, ELK, Xtext Xbase) and 1.0 §3 (EMF GWT). Folio selects the EPL 2.0 for elkjs and ELK, not their
Secondary License. The Folio-specific code is licensed under the MIT license.

Packaged worker: ${worker.file ?? 'not recorded'}${worker.sha256 ? `, SHA-256 ${worker.sha256}` : ''}

## Inputs

| File | License | Role | SHA-256 |
| --- | --- | --- | --- |
${manifest.map(item => `| ${item.file} | ${item.license} | ${item.role} | ${item.sha256} |`).join('\n')}

Each input was downloaded from its pinned URL and verified against the recorded SHA-256 before packaging. The URLs are
listed in manifest.json.

## How the distributed code is produced

1. elkjs' build.gradle (in the elkjs archive) copies the listed ELK plug-in sources, generates Java from the .melk
   option files with the MELK generator (org.eclipse.elk.core.meta, whose source is in the ELK archive), compiles Xtend,
   and runs the GWT 2.13.0 compiler against EMF GWT 2.12.4, Guava 31.1-jre and Xtext Xbase 2.36.0.
2. The published elkjs 0.12.1 npm package contains the generated lib/elk.bundled.js and lib/elk-worker.min.js. Its lib/
   files match the elkjs commit byte for byte.
3. Mermaid ${mermaidVersion} imports elkjs/lib/elk.bundled.js. Folio's Vite build (folio/vite.webview.config.ts, folio/package-lock.json)
   converts and minifies it into the packaged worker chunk. Folio makes no other modification.

The elkjs recipe references a mutable MELK snapshot build (org.eclipse.elk.core.meta 0.13.0-SNAPSHOT) as a code
generator. It is a build tool and is not distributed. The .melk sources it reads, and the generator's own source, are
included above. A rebuild may differ byte for byte if that snapshot changes.

## Notices

The EPL 1.0 and 2.0 texts are in licenses/. GWT and Guava are Apache 2.0 licensed. GWT's i18n runtime includes Unicode
CLDR locale data under the Unicode License. These notices are reproduced in Folio's THIRD_PARTY_NOTICES.md. Upstream
copyright and license headers are preserved inside each source archive.
`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exit(1) })
}
