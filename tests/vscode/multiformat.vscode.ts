import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { writeDocx } from '../../src/document/formats/docx/write'
import { readDocx } from '../../src/document/formats/docx/read'
import { test } from './desktop'

function folio(page: Page) {
  return page.locator('iframe.webview:visible').first().contentFrame().locator('iframe#active-frame').contentFrame()
}

const word = (heading: string) => writeDocx({ type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: heading }] },
  { type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First cell' }] }] },
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second cell' }] }] },
  ] }] },
] })

async function action(page: Page, menu: string, label: string) {
  const frame = folio(page)
  await frame.getByRole('button', { name: menu, exact: true }).click()
  await frame.getByRole('menuitem', { name: label, exact: true }).click()
}

test('TXT defaults to native and Folio edits literal BOM/CRLF text through native history and Save', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const file = 'literal.txt'
  const original = '\uFEFF# Literal  \r\n**Text**\r\n'
  await writeFile(join(workspace, file), original)
  await command('open', { file, editor: 'default' })
  await expect.poll(() => command('activeNativeUri')).toMatch(/literal\.txt$/)
  await command('open', { file, editor: 'folio.txt' })
  const frame = folio(page)
  const source = frame.getByRole('textbox', { name: 'Plain text editor' })
  await expect(source).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Split Editor', exact: true })).toHaveCount(0)
  await source.locator('.cm-line').first().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('✓')
  await expect.poll(async () => (await read(file)).text).toBe('# Literal  ✓\r\n**Text**\r\n')
  await command('undo')
  await expect.poll(async () => (await read(file)).text).toBe(original.slice(1))
  await command('redo')
  await command('save')
  await expect.poll(() => readFile(join(workspace, file), 'utf8')).toBe(original.replace('  ', '  ✓'))
  await expect(frame.getByText('UTF-8 BOM', { exact: true })).toBeVisible()
})

test('TXT discloses unsupported newline fidelity before allowing edits', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'mixed.txt'
  const bytes = '# One\r\nTwo\rThree\n'
  await writeFile(join(workspace, file), bytes)
  await command('open', { file, editor: 'folio.txt' })
  const frame = folio(page)
  await expect(frame.getByRole('alert')).toContainText('line endings')
  await expect(frame.getByRole('textbox', { name: 'Plain text editor' })).toHaveAttribute('contenteditable', 'false')
  expect(await readFile(join(workspace, file), 'utf8')).toBe(bytes)
})

test('DOCX supports native dirty state, Undo/Redo and explicit revert while preserving the source package', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'sample.docx'
  const bytes = writeDocx({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Word heading' }] }] })
  await writeFile(join(workspace, file), bytes)
  await command('open', { file, editor: 'folio.docx' })
  const frame = folio(page)
  const heading = frame.getByRole('heading', { name: /Word heading/ })
  await expect(heading).toHaveText('Word heading')
  await heading.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')
  await expect.poll(() => command('activeTabDirty')).toBe(true)
  await command('undo')
  await expect(heading).toHaveText('Word heading')
  await command('redo')
  await expect(heading).toHaveText('Word heading edited')
  await command('revert')
  await expect(heading).toHaveText('Word heading')
  await expect.poll(() => command('activeTabDirty')).toBe(false)
  expect(await readFile(join(workspace, file))).toEqual(Buffer.from(bytes))
})

test('TXT replaces literal matches, reflects edits from the native buffer and reverts from disk', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const file = 'replace.txt'
  await writeFile(join(workspace, file), '**bold**\n# Visible\n')
  await command('open', { file, editor: 'folio.txt' })
  const frame = folio(page)
  await frame.getByRole('textbox', { name: 'Plain text editor' }).press('ControlOrMeta+h')
  await frame.getByRole('textbox', { name: 'Find text' }).fill('**bold**')
  await frame.getByRole('textbox', { name: 'Replace with' }).fill('`plain`')
  await frame.getByRole('button', { name: 'Replace all' }).click()
  await expect.poll(async () => (await read(file)).text).toBe('`plain`\n# Visible\n')
  await frame.getByRole('button', { name: 'Close find' }).click()
  await command('insert', { file, offset: '`plain`'.length, text: ' native' })
  await expect(frame.getByRole('textbox', { name: 'Plain text editor' })).toContainText('`plain` native')
  await command('revert')
  await expect(frame.getByRole('textbox', { name: 'Plain text editor' })).toContainText('**bold**')
  await expect.poll(async () => (await read(file)).dirty).toBe(false)
})

test('TXT Replace changes only the current match through the find form', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const file = 'single.txt'
  await writeFile(join(workspace, file), 'one two one\n')
  await command('open', { file, editor: 'folio.txt' })
  const frame = folio(page)
  await frame.getByRole('textbox', { name: 'Plain text editor' }).press('ControlOrMeta+h')
  await frame.getByRole('textbox', { name: 'Find text' }).fill('one')
  await expect(frame.getByText('1 of 2 matches')).toBeVisible()
  const replacement = frame.getByRole('textbox', { name: 'Replace with' })
  await replacement.fill('three')
  await frame.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect.poll(async () => (await read(file)).text).toBe('three two one\n')
  await expect(frame.getByText('1 match replaced.')).toBeVisible()
  await replacement.press('Enter')
  await expect.poll(async () => (await read(file)).text).toBe('three two three\n')
})

test('DOCX offers reviewed copy export and verifies original and edited downloads', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'review.docx'
  const original = word('A heading')
  await writeFile(join(workspace, file), original)
  await command('open', { file, editor: 'default' })
  await expect(page.locator('iframe.webview:visible')).toHaveCount(0)
  await command('open', { file, editor: 'folio.docx' })
  const frame = folio(page)
  const heading = frame.getByRole('heading', { name: 'A heading' })
  await expect(heading).toBeVisible()
  const untouched = page.waitForEvent('download')
  await action(page, 'Export', 'Download original')
  const obtained = await untouched
  expect(await readFile(await obtained.path())).toEqual(Buffer.from(original))
  await heading.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('ControlOrMeta+b')
  await expect(heading.locator('strong')).toHaveText('A heading')
  const table = frame.getByRole('textbox', { name: 'Visual document editor' }).getByRole('table')
  await table.getByRole('cell', { name: 'First cell' }).click()
  await action(page, 'Table controls', 'Add row below')
  await expect(table.getByRole('row')).toHaveCount(2)
  await table.getByRole('cell', { name: 'Second cell' }).click()
  await page.keyboard.press('ControlOrMeta+h')
  await frame.getByRole('textbox', { name: 'Find text' }).fill('Second cell')
  await frame.getByRole('textbox', { name: 'Replace with' }).fill('Updated cell')
  await frame.getByRole('button', { name: 'Replace all' }).click()
  await expect(table.getByRole('cell', { name: 'Updated cell' })).toBeVisible()
  await frame.getByRole('button', { name: 'Close find' }).click()
  await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
  await action(page, 'Export', 'Export DOCX copy…')
  const review = frame.getByRole('dialog', { name: 'Export DOCX copy' })
  await expect(review).toContainText('Page layout and styles')
  await review.getByRole('button', { name: 'Cancel' }).click()
  await expect(review).toHaveCount(0)
  expect(await readFile(join(workspace, file))).toEqual(Buffer.from(original))
  await action(page, 'Export', 'Export DOCX copy…')
  const copy = page.waitForEvent('download')
  await review.getByRole('button', { name: 'Download copy' }).click()
  const output = await copy
  expect(output.suggestedFilename()).toBe('review copy.docx')
  const imported = readDocx(await readFile(await output.path())).document
  expect(imported.content?.[0].content?.[0].marks).toContainEqual({ type: 'bold' })
  expect(imported.content?.[1].content).toHaveLength(2)
  expect(JSON.stringify(imported)).toContain('Updated cell')
  expect(await readFile(join(workspace, file))).toEqual(Buffer.from(original))
  await expect.poll(() => command('activeTabDirty')).toBe(true)
})

test('DOCX flags a replacement and native Save protects the replacement until explicit revert', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'external.docx'
  const target = join(workspace, file)
  await writeFile(target, word('Opened package'))
  await command('open', { file, editor: 'folio.docx' })
  const frame = folio(page)
  await frame.getByRole('heading', { name: 'Opened package' }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' draft')
  await expect.poll(() => command('activeTabDirty')).toBe(true)
  await writeFile(target, 'replaced with an invalid package')
  await expect(frame.getByText(/DOCX on disk changed/)).toBeVisible()
  await command('revert')
  await expect(frame.getByText(/Folio kept the DOCX draft because it could not revert/)).toBeVisible()
  await expect.poll(() => command('activeTabDirty')).toBe(true)
  await expect(frame.getByRole('heading', { name: 'Opened package draft' })).toBeVisible()
  const replacement = word('A newer package')
  const other = join(workspace, 'replacement.docx')
  await writeFile(other, replacement)
  await rename(other, target)
  await expect(frame.getByText(/DOCX on disk changed/)).toBeVisible()
  await command('save').catch(() => undefined)
  await expect.poll(() => command('activeTabDirty')).toBe(true)
  await expect(frame.getByRole('heading', { name: 'Opened package draft' })).toBeVisible()
  expect(await readFile(target)).toEqual(Buffer.from(replacement))
  await command('revert')
  await expect(frame.getByRole('heading', { name: 'A newer package' })).toBeVisible()
  expect(await readFile(target)).toEqual(Buffer.from(replacement))
  await writeFile(target, word('A subsequent package'))
  await expect(frame.getByText(/DOCX on disk changed/)).toBeVisible()
  await action(page, 'File', 'Revert to disk')
  await expect(frame.getByRole('heading', { name: 'A subsequent package' })).toBeVisible()
})

test('DOCX rejects an invalid package without offering an editor', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'invalid.docx'
  await writeFile(join(workspace, file), 'not a Word package')
  await command('open', { file, editor: 'folio.docx' })
  await expect(folio(page).getByRole('alert')).toContainText('could not open this DOCX')
  await expect(folio(page).getByRole('textbox', { name: 'Visual document editor' })).toHaveCount(0)
})

test('DOCX rejects an old fidelity review after Revert changes the native revision with the same visible model', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'stale-review.docx'
  const path = join(workspace, file)
  await writeFile(path, word('Same model'))
  await command('open', { file, editor: 'folio.docx' })
  const frame = folio(page)
  await frame.getByRole('heading', { name: 'Same model' }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')
  await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
  await action(page, 'Export', 'Export DOCX copy…')
  const review = frame.getByRole('dialog', { name: 'Export DOCX copy' })
  await expect(review).toBeVisible()
  await writeFile(path, word('Same model edited'))
  await expect(frame.getByText(/DOCX on disk changed/)).toBeVisible()
  await command('revert')
  await expect(frame.getByText('Saved to file', { exact: true })).toBeVisible()
  await review.getByRole('button', { name: 'Download copy' }).click()
  await expect(frame.getByText('The document changed. Start a new export from the current draft.')).toBeVisible()
})

test.describe('native DOCX Save As boundary', () => {
  test.use({ simpleFileDialog: true })

  test('keeps the original and dirty draft on a cancelled Save As and writes only the new file', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const file = 'save-as.docx'
    const original = word('Draft for Save As')
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio.docx' })
    await folio(page).getByRole('heading', { name: 'Draft for Save As' }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' edited')
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    const input = page.locator('.quick-input-widget input:visible')
    await command('saveAs')
    await expect(input).toBeVisible()
    await input.press('Escape')
    await expect(input).toBeHidden()
    await expect.poll(() => command('saveAsOutcome')).toBe('completed')
    await command('saveAs')
    await expect(input).toBeVisible()
    const destination = join(workspace, 'new-copy.docx')
    await input.fill(destination)
    await input.press('Enter')
    await expect.poll(() => command('saveAsOutcome')).toBe('completed')
    // Save As writes a new file from the draft and leaves the opened package unchanged.
    expect(JSON.stringify(readDocx(await readFile(destination)).document)).toContain('Draft for Save As edited')
    expect(await readFile(join(workspace, file))).toEqual(Buffer.from(original))
    // VS Code opens the new file with the default editor because Folio editors are opt-in.
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    await command('open', { file: 'new-copy.docx', editor: 'folio.docx' })
    await expect(folio(page).getByRole('heading', { name: 'Draft for Save As edited' })).toBeVisible()
  })
})

test.describe('workspace boundaries', () => {
  test.use({ virtualWorkspace: true })

  test('DOCX declines a non-file filesystem provider', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'provider.docx'
    await command('addVirtualWorkspace', { file, markdown: 'provider supplied bytes', pixel: '' })
    await command('open', { file, editor: 'folio.docx', virtual: 1 })
    await expect(folio(page).getByRole('alert')).toContainText('requires a trusted workspace and a local file')
    expect(await command('readProviderFile', { file })).toBe('provider supplied bytes')
  })
})

test.describe('Restricted Mode', () => {
  test.use({ restricted: true })

  test('keeps native TXT available and Folio disabled', async ({ desktop }) => {
    const { page, command, workspace } = desktop
    const file = 'restricted.txt'
    await writeFile(join(workspace, file), 'Native in Restricted Mode\n')
    expect(await command('workspaceTrust')).toBe(false)
    await command('open', { file, editor: 'default' })
    await expect.poll(() => command('activeNativeUri')).toMatch(/restricted\.txt$/)
    await command('editorChoices')
    const choices = page.locator('.quick-input-widget:visible')
    await expect(choices.getByText('Text Editor', { exact: true })).toBeVisible()
    await expect(choices.getByText('Folio Plain Text Editor', { exact: true })).toHaveCount(0)
    expect(await command('folioActive')).toBe(false)
  })
})

test.describe('pending native edits', () => {
  test.use({ delayEdits: true })

  test('TXT preserves a conflicting Folio draft through close and reopen', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'pending.txt'
    await writeFile(join(workspace, file), '# literal\n')
    await command('open', { file, editor: 'folio.txt' })
    const source = folio(page).getByRole('textbox', { name: 'Plain text editor' })
    await source.evaluate(() => dispatchEvent(new Event('folio-test-hold-edits')))
    await source.locator('.cm-line').first().click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' Folio')
    await command('insert', { file, offset: '# literal'.length, text: ' native' })
    await source.evaluate(() => dispatchEvent(new Event('folio-test-release-edits')))
    await expect(folio(page).getByText('View VS Code TXT at recovery', { exact: true })).toBeVisible()
    await command('saveDocument', { file })
    await command('close')
    await command('open', { file, editor: 'folio.txt' })
    await folio(page).getByText('View pending TXT', { exact: true }).click()
    await expect(folio(page).getByRole('textbox', { name: 'Pending TXT' })).toHaveValue('# literal Folio\n')
    expect((await read(file)).text).toBe('# literal native\n')
  })

  test('TXT recovers a host-backed draft when the extension host stops before accepting the edit', async ({ desktop }) => {
    const { page, workspace, command, restart } = desktop
    const file = 'txt-restart.txt'
    await writeFile(join(workspace, file), 'literal line\n')
    await command('open', { file, editor: 'folio.txt' })
    const frame = folio(page)
    const source = frame.getByRole('textbox', { name: 'Plain text editor' })
    await source.evaluate(() => {
      dispatchEvent(new Event('folio-test-hold-edits'))
      dispatchEvent(new Event('folio-test-disable-local-storage'))
    })
    await source.locator('.cm-line').first().click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' pending')
    await expect(frame.locator('body')).toHaveAttribute('data-folio-test-stored', '1')
    await restart('host')
    await command('close')
    await command('open', { file, editor: 'folio.txt' })
    const pending = frame.getByText('View pending TXT', { exact: true })
    await expect(pending).toBeVisible()
    await pending.click()
    await expect(frame.getByRole('textbox', { name: 'Pending TXT' })).toHaveValue('literal line pending\n')
    expect(await readFile(join(workspace, file), 'utf8')).toBe('literal line\n')
  })

  test('DOCX preserves a pending transaction through webview disposal and restores it as a native edit', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const file = 'dispose.docx'
    await writeFile(join(workspace, file), word('Initial package'))
    await command('open', { file, editor: 'folio.docx' })
    const heading = folio(page).getByRole('heading', { name: 'Initial package', exact: true })
    await heading.evaluate(() => dispatchEvent(new Event('folio-test-hold-all')))
    await heading.click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' pending')
    await command('close')
    await command('open', { file, editor: 'folio.docx' })
    const frame = folio(page)
    await expect(heading).toBeVisible()
    await frame.getByText('View pending DOCX', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending DOCX' })).toHaveValue(/Initial package pending/)
    await frame.getByRole('button', { name: 'Restore draft as an edit' }).click()
    await expect(frame.getByRole('heading', { name: 'Initial package pending' })).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    await command('undo')
    await expect(heading).toBeVisible()
  })
})

test('DOCX recovers an acknowledged draft after the actual extension host stops', async ({ desktop }) => {
  test.setTimeout(120_000)
  const { page, workspace, command, restart } = desktop
  const file = 'host.docx'
  const original = word('Before interruption')
  await writeFile(join(workspace, file), original)
  await command('open', { file, editor: 'folio.docx' })
  const frame = folio(page)
  await frame.getByRole('heading', { name: 'Before interruption' }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')
  await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
  await expect.poll(() => command('activeTabDirty')).toBe(true)
  await restart('host')
  await command('revert')
  await command('close')
  await command('open', { file, editor: 'folio.docx' })
  const recovered = frame.getByText('View pending DOCX', { exact: true })
  await expect(recovered).toBeVisible()
  await recovered.click()
  await expect(frame.getByRole('textbox', { name: 'Pending DOCX' })).toHaveValue(/Before interruption edited/)
  expect(await readFile(join(workspace, file))).toEqual(Buffer.from(original))
})

test.describe('native DOCX backups', () => {
  test.use({ hotExit: 'onExitAndWindowClose' })

  test('restores a native backup after window reload and retains externally replaced bytes', async ({ desktop }) => {
    test.setTimeout(120_000)
    const { page, workspace, command, restart } = desktop
    const file = 'backup.docx'
    const target = join(workspace, file)
    const original = word('Original backup package')
    await writeFile(target, original)
    await command('open', { file, editor: 'folio.docx' })
    const frame = folio(page)
    await frame.getByRole('heading', { name: 'Original backup package' }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' edited')
    await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    const replacement = word('Replacement from disk')
    await writeFile(target, replacement)
    await expect(frame.getByText(/DOCX on disk changed/)).toBeVisible()
    await restart('window')
    await expect(frame.getByRole('heading', { name: 'Original backup package edited' })).toBeVisible()
    await expect(frame.getByText(/DOCX on disk changed/)).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    expect(await readFile(target)).toEqual(Buffer.from(replacement))
    const download = page.waitForEvent('download')
    await action(page, 'Export', 'Download original')
    expect(await readFile(await (await download).path())).toEqual(Buffer.from(original))
    await frame.getByRole('heading', { name: 'Original backup package edited' }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' again')
    await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
    await command('undo')
    await expect(frame.getByRole('heading', { name: 'Original backup package edited', exact: true })).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)
  })
})
