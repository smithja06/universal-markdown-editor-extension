import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { chromium, test as base, type Browser, type Page } from '@playwright/test'

const prefix = 'folio-vscode-test-'
const timeout = 15_000
type Arguments = Record<string, string | number>
type ConsoleEntry = { kind: string; text: string }

export interface NativeDocument { uri: string; text: string; dirty: boolean; version: number }

interface Desktop {
  page: Page
  workspace: string
  command<T = undefined>(method: string, args?: Arguments): Promise<T>
  read(file: string): Promise<NativeDocument>
  restart(target: 'host' | 'window'): Promise<void>
}

function executable() {
  if (process.env.FOLIO_VSCODE_EXECUTABLE) return process.env.FOLIO_VSCODE_EXECUTABLE
  const candidates = process.platform === 'win32'
    ? [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe')]
    : process.platform === 'darwin' ? ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron']
      : ['/usr/share/code/code', '/usr/bin/code', '/snap/bin/code']
  const found = candidates.find(path => path && existsSync(path))
  if (!found) throw new Error('Set FOLIO_VSCODE_EXECUTABLE to the Visual Studio Code desktop executable.')
  return found
}

async function waitForFile(path: string, process?: ChildProcess) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (process && (process.exitCode !== null || process.signalCode !== null)) {
      throw new Error(`VS Code exited before creating ${basename(path)} (code ${process.exitCode}).`)
    }
    try { return await readFile(path, 'utf8') }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || (error.code !== 'ENOENT' && error.code !== 'EBUSY')) throw error
      await delay(30)
    }
  }
  throw new Error(`VS Code did not create ${basename(path)} within ${timeout} ms.`)
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  if (process.platform !== 'win32') { child.kill(); return }
  const stop = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  await new Promise<void>(done => { stop.once('exit', () => done()); stop.once('error', () => { child.kill(); done() }) })
}

async function stageExtension(extensions: string, delayEdits: boolean) {
  const staged = join(extensions, 'smithja06.folio-markdown-editor-0.1.0')
  const dist = join(staged, 'dist')
  const webview = join(dist, 'webview')
  const build = process.env.FOLIO_BENCHMARK === '1' && process.env.FOLIO_BENCHMARK_BUILD || 'extension/dist'
  await mkdir(dist, { recursive: true })
  await Promise.all([
    copyFile('extension/package.json', join(staged, 'package.json')),
    copyFile(join(build, 'extension.cjs'), join(dist, 'extension.cjs')),
    ...['docx-codec.cjs', 'spreadsheet-codec.cjs', 'spreadsheet.wasm']
      .filter(name => build === 'extension/dist' && existsSync(join(build, name)))
      .map(name => copyFile(join(build, name), join(dist, name))),
    cp(join(build, 'webview'), webview, { recursive: true }),
  ])
  if (process.env.FOLIO_BENCHMARK === '1') {
    // Measure inside the staged extension so the host timing doesn't depend on cross-process clocks.
    const bundle = join(dist, 'extension.cjs')
    const source = await readFile(bundle, 'utf8')
    const start = 'async checkpoint(session, view, client, draft) {'
    const finish = 'generation, stored }, client)'
    if (!source.includes(start) || !source.includes(finish)) throw new Error('The benchmark checkpoint probe did not match the built extension.')
    await writeFile(bundle, source
      .replace(start, start + '\nconst hostCheckpointStarted = performance.now(); const hostReceivedAt = Date.now();')
      .replace(finish, 'generation, stored, hostReceivedAt, hostRepliedAt: Date.now(), hostWriteMs: performance.now() - hostCheckpointStarted }, client)'))
  }
  if (!delayEdits) return
  const index = join(webview, 'index.html')
  const html = await readFile(index, 'utf8')
  const entry = '<script type="module"'
  if (!html.includes(entry)) throw new Error('The built Folio webview entry was not found.')
  await Promise.all([
    copyFile('tests/vscode/delay-edits.js', join(webview, 'assets', 'folio-test-delay-edits.js')),
    writeFile(index, html.replace(entry, `<script src="./assets/folio-test-delay-edits.js"></script>\n    ${entry}`)),
  ])
}

async function installVsix(profile: string, extensions: string, vsix: string) {
  const app = executable()
  const cli = process.env.FOLIO_VSCODE_CLI_JS
  if (!cli) throw new Error('Set FOLIO_VSCODE_CLI_JS to the desktop build’s resources/app/out/cli.js.')
  const args = [resolve(cli), '--user-data-dir', profile, '--extensions-dir', extensions, '--shared-data-dir', join(profile, 'shared')]
  const options = { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  const run = promisify(execFile)
  await run(app, [...args, '--install-extension', resolve(vsix)], options)
  const { stdout } = await run(app, [...args, '--list-extensions', '--show-versions'], options)
  if (!stdout.includes('smithja06.folio-markdown-editor@0.1.0')) throw new Error('The expected VSIX was not installed.')
}

export const test = base.extend<{ desktop: Desktop; delayEdits: boolean; virtualWorkspace: boolean; simpleFileDialog: boolean; secondWorkspace: boolean; hotExit: 'off' | 'onExitAndWindowClose'; restricted: boolean; customDialogs: boolean }>({
  delayEdits: [false, { option: true }],
  virtualWorkspace: [false, { option: true }],
  simpleFileDialog: [false, { option: true }],
  secondWorkspace: [false, { option: true }],
  hotExit: ['off', { option: true }],
  restricted: [false, { option: true }],
  // Renders modal dialogs in the workbench DOM so tests can answer them. Native Windows message boxes are not scriptable.
  customDialogs: [false, { option: true }],
  desktop: async ({ delayEdits, virtualWorkspace, simpleFileDialog, secondWorkspace, hotExit, restricted, customDialogs }, use, testInfo) => {
    const temp = resolve(process.env.FOLIO_VSCODE_TEST_ROOT ?? tmpdir())
    if (process.env.FOLIO_VSCODE_TEST_ROOT) await mkdir(temp, { recursive: true })
    const directory = await mkdtemp(join(temp, prefix))
    const workspace = join(directory, 'workspace')
    const profile = join(directory, 'profile')
    const bridge = join(directory, 'bridge')
    const extensions = join(directory, 'extensions')
    const harness = join(extensions, 'folio-test.desktop-bridge-0.0.1')
    const messages: ConsoleEntry[] = []
    let child: ChildProcess | undefined
    let browser: Browser | undefined
    let page: Page | undefined
    let id = 0
    async function command<T = undefined>(method: string, args: Arguments = {}): Promise<T> {
      const request = ++id
      const pending = join(bridge, 'request.tmp')
      await writeFile(pending, JSON.stringify({ method, args }))
      await rename(pending, join(bridge, `request-${request}.json`))
      if (method === 'stop') return undefined as T
      const reply = await waitForFile(join(bridge, `response-${request}.json`), child)
      const result = JSON.parse(reply) as { error?: string; value: T }
      if (result.error !== undefined) throw new Error(result.error)
      return result.value
    }
    try {
      await Promise.all([mkdir(workspace), mkdir(bridge), mkdir(join(profile, 'User'), { recursive: true }), mkdir(harness, { recursive: true })])
      const vsix = process.env.FOLIO_TEST_VSIX
      await Promise.all([vsix ? installVsix(profile, extensions, vsix) : stageExtension(extensions, delayEdits), copyFile('tests/vscode/host.cjs', join(harness, 'host.cjs')),
        writeFile(join(harness, 'package.json'), JSON.stringify({
          name: 'desktop-bridge', publisher: 'folio-test', version: '0.0.1', engines: { vscode: '^1.100.0' },
          capabilities: { untrustedWorkspaces: { supported: true } },
          activationEvents: ['*'], main: './host.cjs',
        })), writeFile(join(profile, 'User', 'settings.json'), JSON.stringify({
        'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': restricted,
        'security.workspace.trust.startupPrompt': 'never',
        // No extensions.autoUpdate: VS Code 1.147 migrates `false` to "off" by rewriting settings.json shortly after
        // startup, and a window reload racing that write can hang on the backup veto. Without update checks nothing updates.
        'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
        'extensions.autoCheckUpdates': false, 'chat.disableAIFeatures': true,
        'files.autoSave': 'off', 'files.hotExit': hotExit,
        'files.simpleDialog.enable': simpleFileDialog,
        ...(customDialogs ? { 'window.dialogStyle': 'custom' } : {}),
      }))])
      const env: NodeJS.ProcessEnv = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const windowWorkspace = virtualWorkspace || secondWorkspace ? join(directory, 'folio.code-workspace') : workspace
      if (windowWorkspace !== workspace) {
        if (secondWorkspace) await mkdir(join(directory, 'second-workspace'))
        await writeFile(windowWorkspace, JSON.stringify({
          folders: [{ path: './workspace' }, ...(secondWorkspace ? [{ path: './second-workspace' }] : []),
            ...(virtualWorkspace ? [{ uri: 'folio-test-remote://test-server/project', name: 'Provider workspace' }] : [])],
        }))
      }
      child = spawn(executable(), [
        '--user-data-dir=' + profile, '--extensions-dir=' + extensions,
        '--shared-data-dir=' + join(profile, 'shared'),
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--skip-welcome', '--new-window', windowWorkspace,
      ], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.once('error', error => messages.push({ kind: 'spawn error', text: error.message }))
      const processOutput = (kind: string, data: Buffer) => {
        messages.push({ kind, text: data.toString() })
        if (messages.length > 300) messages.shift()
      }
      child.stdout?.on('data', (data: Buffer) => processOutput('VS Code', data))
      child.stderr?.on('data', (data: Buffer) => processOutput('VS Code stderr', data))
      const [port] = (await waitForFile(join(profile, 'DevToolsActivePort'), child)).trim().split('\n')
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      const context = browser.contexts()[0]
      page = context.pages().find(page => page.url().includes('/workbench/')) ?? await context.waitForEvent('page')
      page.on('pageerror', error => messages.push({ kind: 'page error', text: error.message }))
      page.on('console', message => { if (message.type() === 'error') messages.push({ kind: 'console error', text: message.text() }) })
      await page.locator('.monaco-workbench').waitFor()
      await waitForFile(join(bridge, 'ready'), child)
      await use({
        page, workspace, command,
        read: file => command<NativeDocument>('read', { file }),
        async restart(target) {
          const ready = join(bridge, 'ready')
          const previous = await readFile(ready, 'utf8')
          if (target === 'host') {
            // The private bridge marker identifies only this fixture's extension-host process.
            const pid = Number(previous)
            if (!Number.isSafeInteger(pid) || pid <= 0 || pid === child?.pid || pid === process.pid) throw new Error('Invalid test extension host PID.')
            process.kill(pid, 'SIGKILL')
          } else await command('reloadWindow')
          const end = Date.now() + timeout
          while (Date.now() < end) {
            const current = await waitForFile(ready, child)
            if (current && current !== previous) return
            await delay(50)
          }
          const outcome = await readFile(join(bridge, 'activation-error'), 'utf8').catch(() =>
            readFile(join(bridge, 'restart-outcome'), 'utf8').catch(() => 'command did not return'))
          let previousHostAlive = false
          try { process.kill(Number(previous), 0); previousHostAlive = true } catch { /* The previous host exited. */ }
          const window = await page?.locator('body').innerText({ timeout: 1000 }).catch(() => '') ?? ''
          throw new Error(`VS Code did not restart the ${target} (${outcome}, previous host still running: ${previousHostAlive}). ${window.slice(-800)}`)
        },
      })
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        for (const frame of page?.frames() ?? []) {
          const state = await frame.evaluate(() => ({
            body: document.body?.innerText.slice(0, 2000),
            frames: Array.from(document.querySelectorAll('iframe'), iframe => `${iframe.id} ${iframe.className} ${iframe.getAttribute('src') ?? ''}`),
          })).catch(() => undefined)
          if (state) messages.push({ kind: `frame ${frame.url()}`, text: JSON.stringify(state) })
        }
        const logs = join(profile, 'logs')
        const files = await readdir(logs, { recursive: true }).catch(() => [])
        for (const file of files.filter(file => /(?:exthost|renderer)\.log$/.test(file))) {
          const text = await readFile(join(logs, file), 'utf8').catch(() => '')
          if (text) messages.push({ kind: file, text: text.slice(-16_000) })
        }
        if (messages.length) await testInfo.attach('vscode.log', { body: messages.map(entry => `${entry.kind}: ${entry.text}`).join('\n'), contentType: 'text/plain' })
      }
      if (child) await command('stop').catch(() => undefined)
      await browser?.close().catch(() => undefined)
      if (child) await stopProcess(child)
      if (dirname(directory) === temp && basename(directory).startsWith(prefix)) {
        await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
      }
    }
  },
})
