// Loaded as a temporary fixture extension in an isolated test workspace only.
const { readFile, rename, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { queryObjects } = require('node:v8')
const vscode = require('vscode')
const directory = join(__dirname, '..', '..', 'bridge')
const virtualRoot = vscode.Uri.parse('folio-test-remote://test-server/project')
const virtualFiles = new Map([['/project', null], ['/project/docs', null], ['/project/media', null]])
const virtualChanges = new vscode.EventEmitter()
const qualificationDirectory = vscode.Uri.joinPath(virtualRoot, 'media')
const qualificationPath = /^\/project\/media\/qualification-[a-z0-9-]+\.(?:stage|png)$/
// Querying an uninstantiated class requests GC without allocating an array of live objects.
class HeapProbe {}
let attachmentFault
let attachmentWriteOptions
let saveAsOutcome

function fileStat(type, size = 0) { return { type, size, ctime: 0, mtime: 0 } }
function virtualFile(uri) {
  const entry = virtualFiles.get(uri.path)
  if (uri.authority !== virtualRoot.authority || entry === undefined) throw vscode.FileSystemError.FileNotFound(uri)
  return entry
}

function uri(file, virtual = false) {
  if (typeof file !== 'string' || !/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(md|markdown|txt|docx|pdf)$/.test(file)) throw new Error('Invalid test document name.')
  return vscode.Uri.joinPath(virtual ? vscode.Uri.joinPath(virtualRoot, 'docs') : vscode.workspace.workspaceFolders[0].uri, file)
}

function attachmentUri(name) {
  const target = vscode.Uri.joinPath(qualificationDirectory, `qualification-${name}`)
  if (!qualificationPath.test(target.path)) throw new Error('Invalid attachment fixture path.')
  return target
}

async function fsOutcome(operation) {
  try { await operation; return 'ok' }
  catch (error) { return error.code ?? error.name }
}

const operations = {
  hostMetrics({ collectGarbage }) {
    if (collectGarbage) queryObjects(HeapProbe)
    const { rss, heapUsed } = process.memoryUsage()
    const { user, system } = process.cpuUsage()
    return { rss, heapUsed, cpu: user + system }
  },
  async enableAutosave() {
    const files = vscode.workspace.getConfiguration('files')
    await files.update('autoSaveDelay', 1000, vscode.ConfigurationTarget.Global)
    await files.update('autoSave', 'afterDelay', vscode.ConfigurationTarget.Global)
  },
  async open({ file, editor, column, virtual }) {
    const options = { viewColumn: column ?? vscode.ViewColumn.One, preview: false }
    if (editor === 'folio') await vscode.commands.executeCommand('vscode.openWith', uri(file, virtual), 'folio.markdown', options)
    else if (editor === 'folio.txt' || editor === 'folio.docx' || editor === 'folio.pdf') await vscode.commands.executeCommand('vscode.openWith', uri(file, virtual), editor, options)
    else if (editor === 'default') await vscode.commands.executeCommand('vscode.open', uri(file, virtual), options)
    else await vscode.window.showTextDocument(uri(file, virtual), options)
  },
  activeNativeUri: () => vscode.window.activeTextEditor?.document.uri.toString() ?? null,
  activeTabDirty: () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty ?? null,
  activeCustomEditor() {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    return input instanceof vscode.TabInputCustom ? input.viewType : null
  },
  openTabs: () => vscode.window.tabGroups.all.flatMap(group => group.tabs).length,
  clipboard: () => vscode.env.clipboard.readText(),
  setClipboard: ({ text }) => vscode.env.clipboard.writeText(text),
  workspaceTrust: () => vscode.workspace.isTrusted,
  folioActive: () => vscode.extensions.getExtension('smithja06.folio-markdown-editor')?.isActive ?? false,
  editorChoices() { void vscode.commands.executeCommand('workbench.action.reopenWithEditor') },
  activeNativeLine: () => vscode.window.activeTextEditor?.selection.active.line ?? null,
  async read({ file, virtual }) {
    const document = await vscode.workspace.openTextDocument(uri(file, virtual))
    return { uri: document.uri.toString(), text: document.getText(), dirty: document.isDirty, version: document.version }
  },
  async insert({ file, offset, text, virtual }) {
    const document = await vscode.workspace.openTextDocument(uri(file, virtual))
    const edit = new vscode.WorkspaceEdit()
    edit.insert(document.uri, document.positionAt(offset), text)
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the native test edit.')
  },
  save: () => vscode.commands.executeCommand('workbench.action.files.save'),
  saveAs() {
    saveAsOutcome = 'pending'
    void vscode.commands.executeCommand('workbench.action.files.saveAs').then(
      () => { saveAsOutcome = 'completed' },
      error => { saveAsOutcome = String(error) },
    )
  },
  saveAsOutcome: () => saveAsOutcome,
  revert: () => vscode.commands.executeCommand('workbench.action.files.revert'),
  theme: ({ theme }) => vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global),
  showPalette: () => vscode.commands.executeCommand('workbench.action.showCommands'),
  addVirtualWorkspace({ markdown, pixel, file = 'source.md', base64 }) {
    if (!vscode.workspace.getWorkspaceFolder(virtualRoot)) throw new Error('The provider workspace was not opened.')
    virtualFiles.set(uri(file, true).path, base64 ? Buffer.from(base64, 'base64') : Buffer.from(markdown))
    virtualFiles.set('/project/docs/target.md', Buffer.from('# Virtual destination\n'))
    virtualFiles.set('/project/target.md', Buffer.from('# Provider root destination\n\nDetails.\n'))
    virtualFiles.set('/project/media/pixel.png', Buffer.from(pixel, 'base64'))
    virtualFiles.set('/project/media/race.png', Buffer.from(pixel, 'base64'))
    virtualFiles.set('/project/media/café #%(final)%2F.png', Buffer.from(pixel, 'base64'))
    virtualFiles.set('/project/docs/secret-link.png', 'symlink')
    virtualFiles.set('/workspace', null)
    virtualFiles.set('/workspace/pixel.png', Buffer.from(pixel, 'base64'))
  },
  pixelReads: () => pixelReads,
  unsafeReads: () => unsafeReads,
  boundaryReads: () => boundaryReads,
  setProviderUnavailable({ unavailable }) { providerUnavailable = !!unavailable },
  providerStatFailures: () => providerStatFailures,
  async attachmentCreate({ name, contents, method, fault }) {
    const target = attachmentUri(name)
    const bytes = Buffer.from(contents)
    attachmentFault = fault
    attachmentWriteOptions = undefined
    try {
      if (method === 'workspaceEdit') {
        const edit = new vscode.WorkspaceEdit()
        edit.createFile(target, { contents: bytes, overwrite: false })
        return { applied: await vscode.workspace.applyEdit(edit), options: attachmentWriteOptions }
      }
      return { outcome: await fsOutcome(vscode.workspace.fs.writeFile(target, bytes)), options: attachmentWriteOptions }
    } finally { attachmentFault = undefined }
  },
  async attachmentPublish({ first, second, to, fault }) {
    const target = attachmentUri(to)
    attachmentFault = fault
    try {
      return await Promise.all((second ? [first, second] : [first]).map(name =>
        fsOutcome(vscode.workspace.fs.rename(attachmentUri(name), target, { overwrite: false }))))
    } finally { attachmentFault = undefined }
  },
  async attachmentRead({ name }) {
    try { return Buffer.from(await vscode.workspace.fs.readFile(attachmentUri(name))).toString('utf8') }
    catch (error) {
      if (error.code === 'FileNotFound') return null
      throw error
    }
  },
  attachmentDelete: ({ name }) => vscode.workspace.fs.delete(attachmentUri(name), { recursive: false }),
  async readProviderFile({ file, encoding = 'utf8' }) {
    try { return Buffer.from(await vscode.workspace.fs.readFile(uri(file, true))).toString(encoding) }
    catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return null
      throw error
    }
  },
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
  async rename({ file, to, virtual }) {
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(uri(file, virtual), uri(to, virtual))
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the native test rename.')
  },
  async deleteFile({ file, virtual }) {
    const edit = new vscode.WorkspaceEdit()
    edit.deleteFile(uri(file, virtual))
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the native test deletion.')
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
let boundaryReads = 0
let providerUnavailable = false
let providerStatFailures = 0
exports.activate = context => {
  context.subscriptions.push(virtualChanges, vscode.workspace.registerFileSystemProvider(virtualRoot.scheme, {
    onDidChangeFile: virtualChanges.event,
    watch() { return new vscode.Disposable(() => undefined) },
    stat(uri) {
      const entry = virtualFile(uri)
      if (providerUnavailable) {
        if (uri.path === '/project/docs/source.md') providerStatFailures++
        throw vscode.FileSystemError.Unavailable(uri)
      }
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
      if (providerUnavailable) throw vscode.FileSystemError.Unavailable(uri)
      if (!entry) throw vscode.FileSystemError.FileIsADirectory(uri)
      if (entry === 'symlink') { unsafeReads++; throw new Error('Folio must never read through this symlink.') }
      if (uri.path.endsWith('/pixel.png')) pixelReads++
      if (uri.path === '/workspace/pixel.png') boundaryReads++
      if (uri.path.endsWith('/race.png')) virtualFiles.set(uri.path, 'symlink')
      return entry
    },
    writeFile(uri, content, options) {
      if (uri.authority !== virtualRoot.authority || !qualificationPath.test(uri.path)) virtualFile(uri)
      if (providerUnavailable) throw vscode.FileSystemError.Unavailable(uri)
      const qualification = qualificationPath.test(uri.path)
      if (qualification) {
        attachmentWriteOptions = options
        if (attachmentFault === 'concurrent-create') virtualFiles.set(uri.path, Buffer.from('concurrent bytes'))
      }
      const exists = virtualFiles.has(uri.path)
      if (exists && options.create && !options.overwrite) throw vscode.FileSystemError.FileExists(uri)
      if (!exists && !options.create) throw vscode.FileSystemError.FileNotFound(uri)
      if (qualification && attachmentFault === 'partial-write') {
        virtualFiles.set(uri.path, Buffer.from(content.subarray(0, 4)))
        throw vscode.FileSystemError.Unavailable(uri)
      }
      virtualFiles.set(uri.path, Buffer.from(content))
      virtualChanges.fire([{ type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }])
    },
    createDirectory() { throw vscode.FileSystemError.NoPermissions() },
    delete(uri) {
      if (!Buffer.isBuffer(virtualFile(uri))) throw vscode.FileSystemError.NoPermissions(uri)
      virtualFiles.delete(uri.path)
      virtualChanges.fire([{ type: vscode.FileChangeType.Deleted, uri }])
    },
    rename(from, to, options) {
      const entry = virtualFile(from)
      if (to.authority !== virtualRoot.authority || !Buffer.isBuffer(entry)) throw vscode.FileSystemError.NoPermissions(from)
      if (virtualFiles.has(to.path) && !options.overwrite) throw vscode.FileSystemError.FileExists(to)
      virtualFiles.set(to.path, entry)
      virtualFiles.delete(from.path)
      virtualChanges.fire([{ type: vscode.FileChangeType.Deleted, uri: from }, { type: vscode.FileChangeType.Created, uri: to }])
      if (qualificationPath.test(to.path) && attachmentFault === 'lost-publish-reply') throw vscode.FileSystemError.Unavailable(to)
    },
  }, { isCaseSensitive: true }))
  void run().catch(error => writeFile(join(directory, 'activation-error'), String(error)))
}
