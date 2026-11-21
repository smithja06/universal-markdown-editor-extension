import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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

async function stageExtension(directory: string) {
  const staged = join(directory, 'extension')
  const dist = join(staged, 'dist')
  const webview = join(dist, 'webview')
  await mkdir(dist, { recursive: true })
  await Promise.all([
    copyFile('extension/package.json', join(staged, 'package.json')),
    copyFile('extension/dist/extension.cjs', join(dist, 'extension.cjs')),
    cp('extension/dist/webview', webview, { recursive: true }),
  ])
  const index = join(webview, 'index.html')
  const html = await readFile(index, 'utf8')
  const entry = '<script type="module"'
  if (!html.includes(entry)) throw new Error('The built Folio webview entry was not found.')
  await Promise.all([
    copyFile('tests/vscode/delay-edits.js', join(webview, 'assets', 'folio-test-delay-edits.js')),
    writeFile(index, html.replace(entry, `<script src="./assets/folio-test-delay-edits.js"></script>\n    ${entry}`)),
  ])
  return staged
}

export const test = base.extend<{ desktop: Desktop; delayEdits: boolean }>({
  delayEdits: [false, { option: true }],
  desktop: async ({ delayEdits }, use, testInfo) => {
    const temp = resolve(tmpdir())
    const directory = await mkdtemp(join(temp, prefix))
    const workspace = join(directory, 'workspace')
    const profile = join(directory, 'profile')
    const bridge = join(directory, 'bridge')
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
      await Promise.all([mkdir(workspace), mkdir(bridge), mkdir(join(profile, 'User'), { recursive: true })])
      await writeFile(join(profile, 'User', 'settings.json'), JSON.stringify({
        'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false,
        'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false, 'chat.disableAIFeatures': true,
        'files.autoSave': 'off', 'files.hotExit': 'off',
      }))
      const env: NodeJS.ProcessEnv = { ...process.env, FOLIO_VSCODE_TEST_BRIDGE: bridge }
      delete env.ELECTRON_RUN_AS_NODE
      const extension = delayEdits ? await stageExtension(directory) : resolve('extension')
      child = spawn(executable(), [
        '--user-data-dir=' + profile, '--extensions-dir=' + join(directory, 'extensions'),
        '--extensionDevelopmentPath=' + extension, '--extensionTestsPath=' + resolve('tests/vscode/host.cjs'),
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--skip-welcome', '--new-window', workspace,
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
      await use({ page, workspace, command, read: file => command<NativeDocument>('read', { file }) })
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
