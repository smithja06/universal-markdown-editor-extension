// Prepares and verifies the GitHub Release files for one version tag. Used by .github/workflows/release.yml and
// runnable locally after `npm run package:extension` and `npm run source:companion`.
//
// Usage: node scripts/release-assets.mjs [tag]   (default: GITHUB_REF_NAME, then v<extension version>)
//
// Checks, and fails on any mismatch:
// - the tag is v<version> from extension/package.json, and the packaged manifest has the same version
// - the notices in the VSIX name this version's corpus URL
// - the source companion's manifest.json records the exact ELK chunk inside the VSIX
// Writes release/ with versioned file names, .sha256 files, SOURCE.md and RELEASE_NOTES.md.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }

const manifest = JSON.parse(await readFile('extension/package.json', 'utf8'))
const version = manifest.version
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? `v${version}`
if (tag !== `v${version}`) fail(`Tag ${tag} does not match extension version ${version}. Tag the commit as v${version}.`)
const repository = /github\.com\/([^/]+\/[^/.]+)/.exec(manifest.repository?.url ?? '')?.[1] ?? fail('extension/package.json has no GitHub repository URL.')
const companionName = `folio-elk-source-companion-${version}.zip`
const companionUrl = `https://github.com/${repository}/releases/download/${tag}/${companionName}`

const vsix = new Uint8Array(await readFile('extension/dist/folio.vsix'))
const entries = unzipSync(vsix, { filter: file => file.name === 'extension/package.json' || file.name === 'extension/THIRD_PARTY_NOTICES.md' || /^extension\/dist\/webview\/assets\/elk-[^/]+\.js$/.test(file.name) })
const packaged = JSON.parse(strFromU8(entries['extension/package.json'] ?? fail('The VSIX has no extension/package.json.')))
if (packaged.version !== version) fail(`The VSIX is version ${packaged.version}, not ${version}. Run npm run package:extension again.`)
const notices = strFromU8(entries['extension/THIRD_PARTY_NOTICES.md'] ?? fail('The VSIX has no THIRD_PARTY_NOTICES.md.'))
if (!notices.includes(companionUrl)) fail(`The packaged notices do not name ${companionUrl}.`)
const workers = Object.keys(entries).filter(name => name.includes('/elk-'))
if (workers.length !== 1) fail(`Expected one ELK chunk in the VSIX, found ${workers.length}.`)
const workerFile = workers[0].replace(/^extension\//, '')
const workerSha = sha(entries[workers[0]])

const companion = new Uint8Array(await readFile('extension/dist/source-companion/folio-elk-source-companion.zip'))
const companionManifest = JSON.parse(strFromU8(unzipSync(companion, { filter: file => file.name === 'manifest.json' })['manifest.json'] ?? fail('The companion has no manifest.json.')))
if (companionManifest.worker?.file !== workerFile || companionManifest.worker?.sha256 !== workerSha) {
  fail(`The companion records ${companionManifest.worker?.file} ${companionManifest.worker?.sha256}, but the VSIX holds ${workerFile} ${workerSha}. Run npm run source:companion after packaging.`)
}

const changelog = await readFile('extension/CHANGELOG.md', 'utf8')
const section = new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(changelog)?.[1]?.trim()
if (!section) fail(`extension/CHANGELOG.md has no "## ${version}" section.`)

const vsixName = `folio-${version}.vsix`
const files = { [vsixName]: vsix, [companionName]: companion }
await rm('release', { recursive: true, force: true })
await mkdir('release', { recursive: true })
const sums = {}
for (const [name, bytes] of Object.entries(files)) {
  sums[name] = sha(bytes)
  await writeFile(join('release', name), bytes)
  await writeFile(join('release', `${name}.sha256`), `${sums[name]}  ${name}\n`)
}
const source = `# Corresponding source for Folio ${version}

\`${companionName}\` is the corresponding source for the Eclipse-licensed Eclipse Layout Kernel runtime that Mermaid uses in \`${vsixName}\`. Its README explains how to rebuild the ELK worker. Its manifest lists every pinned input with its SHA-256.

| File | SHA-256 |
| --- | --- |
| ${vsixName} | ${sums[vsixName]} |
| ${companionName} | ${sums[companionName]} |
| ELK chunk \`${workerFile}\` in the VSIX | ${workerSha} |

Permanent link: ${companionUrl}
`
await writeFile(join('release', 'SOURCE.md'), source)
await writeFile(join('release', 'RELEASE_NOTES.md'), `${section}\n\n## Files\n\n${source.split('\n').slice(4).join('\n')}`)
console.log(`release/ ready for ${tag}`)
for (const [name, digest] of Object.entries(sums)) console.log(`  ${name} ${digest}`)
console.log(`  ELK chunk ${workerFile} ${workerSha}`)
