// Loaded as a temporary fixture extension in an isolated test workspace only.
const { readFile, rename, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const vscode = require('vscode')
const directory = join(__dirname, '..', '..', 'bridge')
const virtualRoot = vscode.Uri.parse('folio-test-remote://test-server/project')
const virtualFiles = new Map([['/project', null], ['/project/docs', null], ['/project/media', null]])
const virtualChanges = new vscode.EventEmitter()

function fileStat(type, size = 0) { return { type, size, ctime: 0, mtime: 0 } }
function virtualFile(uri) {
  const entry = virtualFiles.get(uri.path)
  if (uri.authority !== virtualRoot.authority || entry === undefined) throw vscode.FileSystemError.FileNotFound(uri)
  return entry
}

function uri(file, virtual = false) {
  if (typeof file !== 'string' || !/^[a-z0-9-]+\.(md|markdown)$/.test(file)) throw new Error('Invalid test document name.')
  return vscode.Uri.joinPath(virtual ? vscode.Uri.joinPath(virtualRoot, 'docs') : vscode.workspace.workspaceFolders[0].uri, file)
}

const operations = {
  hostMetrics() {
    const { rss, heapUsed } = process.memoryUsage()
    const { user, system } = process.cpuUsage()
    return { rss, heapUsed, cpu: user + system }
  },
  async open({ file, editor, column, virtual }) {
    const options = { viewColumn: column ?? vscode.ViewColumn.One, preview: false }
    if (editor === 'folio') await vscode.commands.executeCommand('vscode.openWith', uri(file, virtual), 'folio.markdown', options)
    else if (editor === 'default') await vscode.commands.executeCommand('vscode.open', uri(file, virtual), options)
    else await vscode.window.showTextDocument(uri(file, virtual), options)
  },
  activeNativeUri: () => vscode.window.activeTextEditor?.document.uri.toString() ?? null,
  activeNativeLine: () => vscode.window.activeTextEditor?.selection.active.line ?? null,
  async read({ file, virtual }) {
    const document = await vscode.workspace.openTextDocument(uri(file, virtual))
    return { uri: document.uri.toString(), text: document.getText(), dirty: document.isDirty, version: document.version }
  },
  async insert({ file, offset, text }) {
    const document = await vscode.workspace.openTextDocument(uri(file))
    const edit = new vscode.WorkspaceEdit()
    edit.insert(document.uri, document.positionAt(offset), text)
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the native test edit.')
  },
  save: () => vscode.commands.executeCommand('workbench.action.files.save'),
  theme: ({ theme }) => vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global),
  showPalette: () => vscode.commands.executeCommand('workbench.action.showCommands'),
  addVirtualWorkspace({ markdown, pixel }) {
    if (!vscode.workspace.getWorkspaceFolder(virtualRoot)) throw new Error('The provider workspace was not opened.')
    virtualFiles.set('/project/docs/source.md', Buffer.from(markdown))
    virtualFiles.set('/project/docs/target.md', Buffer.from('# Virtual destination\n'))
    virtualFiles.set('/project/media/pixel.png', Buffer.from(pixel, 'base64'))
    virtualFiles.set('/project/media/race.png', Buffer.from(pixel, 'base64'))
    virtualFiles.set('/project/docs/secret-link.png', 'symlink')
  },
  pixelReads: () => pixelReads,
  unsafeReads: () => unsafeReads,
  async saveDocument({ file, virtual }) {
    if (!await (await vscode.workspace.openTextDocument(uri(file, virtual))).save()) throw new Error('Could not save the test document.')
  },
  undo: () => vscode.commands.executeCommand('undo'),
  redo: () => vscode.commands.executeCommand('redo'),
  close: () => vscode.commands.executeCommand('workbench.action.closeActiveEditor'),
  reopenText: () => vscode.commands.executeCommand('workbench.action.reopenTextEditor'),
  async closeFolio({ file }) {
    const resource = uri(file).toString()
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
      tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'folio.markdown' && tab.input.uri.toString() === resource)
    if (tabs.length) await vscode.window.tabGroups.close(tabs)
  },
  reloadWindow() {
    setTimeout(async () => {
      let outcome = 'command completed'
      try { await vscode.commands.executeCommand('workbench.action.reloadWindow') }
      catch (error) { outcome = String(error) }
      await writeFile(join(directory, 'restart-outcome'), outcome).catch(() => undefined)
    }, 200)
  },
  async rename({ file, to }) {
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(uri(file), uri(to))
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the native test rename.')
  },
}

async function run() {
  if (!vscode.workspace.workspaceFolders?.length) throw new Error('Missing the isolated Folio test workspace.')
  const cursor = join(directory, 'cursor')
  const next = await readFile(cursor, 'utf8').then(Number, error => {
    if (error.code !== 'ENOENT') throw error
    return 1
  })
  await writeFile(join(directory, 'ready'), String(process.pid))
  for (let id = next; ; id++) {
    let raw
    while (raw === undefined) {
      try { raw = await readFile(join(directory, `request-${id}.json`), 'utf8') }
      catch (error) {
        if (error.code !== 'ENOENT') throw error
        await delay(20)
      }
    }
    const { method, args } = JSON.parse(raw)
    if (method === 'stop') return
    await writeFile(cursor, String(id + 1))
    let result
    try {
      if (!Object.hasOwn(operations, method)) throw new Error('Unsupported test operation.')
      result = { value: await operations[method](args) }
    } catch (error) { result = { error: error instanceof Error ? error.stack : String(error) } }
    const temporary = join(directory, 'response.tmp')
    await writeFile(temporary, JSON.stringify(result))
    await rename(temporary, join(directory, `response-${id}.json`))
  }
}

let pixelReads = 0
let unsafeReads = 0
exports.activate = context => {
  context.subscriptions.push(virtualChanges, vscode.workspace.registerFileSystemProvider(virtualRoot.scheme, {
    onDidChangeFile: virtualChanges.event,
    watch() { return new vscode.Disposable(() => undefined) },
    stat(uri) {
      const entry = virtualFile(uri)
      if (entry === null) return fileStat(vscode.FileType.Directory)
      if (entry === 'symlink') return fileStat(vscode.FileType.File | vscode.FileType.SymbolicLink)
      return fileStat(vscode.FileType.File, entry.length)
    },
    readDirectory(uri) {
      const prefix = uri.path + '/'
      return [...virtualFiles.entries()].flatMap(([path, entry]) => {
        const name = path.slice(prefix.length)
        return path.startsWith(prefix) && !name.includes('/') ? [[name, entry === null ? vscode.FileType.Directory : vscode.FileType.File]] : []
      })
    },
    readFile(uri) {
      const entry = virtualFile(uri)
      if (!entry) throw vscode.FileSystemError.FileIsADirectory(uri)
      if (entry === 'symlink') { unsafeReads++; throw new Error('Folio must never read through this symlink.') }
      if (uri.path.endsWith('/pixel.png')) pixelReads++
      if (uri.path.endsWith('/race.png')) virtualFiles.set(uri.path, 'symlink')
      return entry
    },
    writeFile(uri, content) {
      virtualFile(uri)
      virtualFiles.set(uri.path, Buffer.from(content))
      virtualChanges.fire([{ type: vscode.FileChangeType.Changed, uri }])
    },
    createDirectory() { throw vscode.FileSystemError.NoPermissions() },
    delete() { throw vscode.FileSystemError.NoPermissions() },
    rename() { throw vscode.FileSystemError.NoPermissions() },
  }, { isCaseSensitive: true }))
  void run().catch(error => writeFile(join(directory, 'activation-error'), String(error)))
}
