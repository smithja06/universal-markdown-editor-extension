// Loaded by VS Code's --extensionTestsPath in an isolated test workspace only.
const { readFile, rename, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const vscode = require('vscode')

function uri(file) {
  if (typeof file !== 'string' || !/^[a-z0-9-]+\.(md|markdown)$/.test(file)) throw new Error('Invalid test document name.')
  return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, file)
}

const operations = {
  async open({ file, editor, column }) {
    const options = { viewColumn: column ?? vscode.ViewColumn.One, preview: false }
    if (editor === 'folio') await vscode.commands.executeCommand('vscode.openWith', uri(file), 'folio.markdown', options)
    else if (editor === 'default') await vscode.commands.executeCommand('vscode.open', uri(file), options)
    else await vscode.window.showTextDocument(uri(file), options)
  },
  activeNativeUri: () => vscode.window.activeTextEditor?.document.uri.toString() ?? null,
  async read({ file }) {
    const document = await vscode.workspace.openTextDocument(uri(file))
    return { uri: document.uri.toString(), text: document.getText(), dirty: document.isDirty, version: document.version }
  },
  async insert({ file, offset, text }) {
    const document = await vscode.workspace.openTextDocument(uri(file))
    const edit = new vscode.WorkspaceEdit()
    edit.insert(document.uri, document.positionAt(offset), text)
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the native test edit.')
  },
  save: () => vscode.commands.executeCommand('workbench.action.files.save'),
  undo: () => vscode.commands.executeCommand('undo'),
  redo: () => vscode.commands.executeCommand('redo'),
  close: () => vscode.commands.executeCommand('workbench.action.closeActiveEditor'),
  async rename({ file, to }) {
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(uri(file), uri(to))
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the native test rename.')
  },
}

async function run() {
  const directory = process.env.FOLIO_VSCODE_TEST_BRIDGE
  if (!directory || !vscode.workspace.workspaceFolders?.length) throw new Error('Missing the isolated Folio test workspace.')
  await writeFile(join(directory, 'ready'), '')
  for (let id = 1; ; id++) {
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

module.exports = { run }
