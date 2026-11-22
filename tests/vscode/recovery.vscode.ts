import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { test } from './desktop'

const end = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const original = '# Shared\r\n\r\n  **Keep**\r\n'

function folio(page: Page, index = 0) {
  return page.locator('iframe.webview:visible').nth(index).contentFrame().locator('iframe#active-frame').contentFrame()
}

async function editWhileHeld(page: Page, hold = 'folio-test-hold-edits', localStorage = true) {
  const heading = folio(page).getByRole('heading', { name: 'Shared', exact: true })
  await heading.evaluate((_element, { hold, localStorage }) => {
    dispatchEvent(new Event(hold))
    if (!localStorage) dispatchEvent(new Event('folio-test-disable-local-storage'))
  }, { hold, localStorage })
  await heading.click()
  await page.keyboard.press(end)
  await page.keyboard.insertText(' Folio')
  await page.keyboard.insertText(' draft')
}

test.describe('unacknowledged edits', () => {
  test.use({ delayEdits: true })

  test('recovers the newest draft after immediate close and reopen without replacing newer native text', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'close.md'
    await writeFile(join(workspace, file), '\uFEFF' + original)
    await command('open', { file, editor: 'folio' })
    await editWhileHeld(page, 'folio-test-hold-all')
    await command('close')
    await command('open', { file, editor: 'native' })
    await command('insert', { file, offset: 2, text: 'Native ' })
    await command('save')
    await command('close')
    await command('open', { file, editor: 'folio' })

    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Native Shared' })).toBeVisible()
    await frame.getByText('View pending Markdown', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue('# Shared Folio draft\n\n  **Keep**\n')
    await frame.getByRole('button', { name: 'Copy pending draft' }).click()
    await expect(frame.locator('body')).toHaveAttribute('data-folio-test-copied', JSON.stringify('\uFEFF# Shared Folio draft\r\n\r\n  **Keep**\r\n'))
    await expect(frame.locator('body')).toHaveAttribute('data-folio-test-copy-result', 'true')
    expect((await read(file)).text).toBe('# Native Shared\r\n\r\n  **Keep**\r\n')
    expect(await readFile(join(workspace, file), 'utf8')).toBe('\uFEFF# Native Shared\r\n\r\n  **Keep**\r\n')
    await frame.getByRole('button', { name: 'Discard pending draft' }).click()
    await expect(frame.getByText('View pending Markdown', { exact: true })).toHaveCount(0)
    await command('close')
    await command('open', { file, editor: 'folio' })
    await expect(folio(page).getByRole('heading', { name: 'Native Shared' })).toBeVisible()
    await expect(folio(page).getByText('View pending Markdown', { exact: true })).toHaveCount(0)
  })

  test('keeps pending input while hidden and orders Folio Save and Undo after the acknowledged edits', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'hide.md'
    await writeFile(join(workspace, file), original)
    await writeFile(join(workspace, 'other.md'), '# Other\n')
    await command('open', { file, editor: 'folio' })
    await editWhileHeld(page)
    await page.keyboard.press(`${modifier}+s`)
    await page.keyboard.press(`${modifier}+z`)
    await command('open', { file: 'other.md', editor: 'native' })
    expect((await read(file)).text).toBe(original)
    await command('open', { file, editor: 'folio' })
    await expect(folio(page).getByRole('heading', { name: 'Shared Folio draft' })).toBeVisible()
    await folio(page).getByRole('heading', { name: 'Shared Folio draft' }).evaluate(() => dispatchEvent(new Event('folio-test-release-edits')))
    await expect.poll(() => readFile(join(workspace, file), 'utf8')).toBe('# Shared Folio draft\r\n\r\n  **Keep**\r\n')
    await expect.poll(async () => (await read(file)).text).toBe('# Shared Folio\r\n\r\n  **Keep**\r\n')
  })

  test('recovers an edit when the same tab immediately switches to the native editor', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'switch.md'
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio' })
    await editWhileHeld(page, 'folio-test-hold-all')
    await command('reopenText')
    const uri = (await read(file)).uri
    await expect.poll(() => command('activeNativeUri')).toBe(uri)
    await command('save')
    expect(await readFile(join(workspace, file), 'utf8')).toBe(original)
    await command('open', { file, editor: 'folio' })
    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Shared', exact: true })).toBeVisible()
    await frame.getByText('View pending Markdown', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue('# Shared Folio draft\n\n  **Keep**\n')
  })

  test('honors native Save and Undo while a disjoint Folio edit is in flight', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'native-undo.md'
    const path = join(workspace, file)
    await writeFile(path, original)
    await command('open', { file, editor: 'folio', column: 1 })
    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Shared', exact: true })).toBeVisible()
    await command('open', { file, editor: 'native', column: 2 })
    await command('insert', { file, offset: original.indexOf('Keep'), text: 'Native ' })
    await expect(frame.getByRole('textbox', { name: 'Visual document editor' })).toContainText('Native Keep')
    await editWhileHeld(page)
    await command('open', { file, editor: 'native', column: 2 })
    await command('save')
    expect(await readFile(path, 'utf8')).toBe('# Shared\r\n\r\n  **Native Keep**\r\n')
    await command('undo')
    await expect.poll(async () => (await read(file)).text).toBe(original)
    await frame.getByRole('heading', { name: 'Shared Folio draft' }).evaluate(() => dispatchEvent(new Event('folio-test-release-edits')))
    await expect.poll(async () => (await read(file)).text).toBe('# Shared Folio draft\r\n\r\n  **Keep**\r\n')
    expect((await read(file)).dirty).toBe(true)
  })

  test('keeps separate pending drafts from two Folio views of the same file', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'two-views.md'
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio', column: 1 })
    await editWhileHeld(page, 'folio-test-hold-all')
    await command('open', { file, editor: 'folio', column: 2 })
    const second = folio(page, 1).getByRole('heading', { name: 'Shared', exact: true })
    await second.evaluate(() => dispatchEvent(new Event('folio-test-hold-all')))
    await second.click()
    await page.keyboard.press(end)
    await page.keyboard.insertText(' second draft')
    await command('closeFolio', { file })
    await command('open', { file, editor: 'folio', column: 1 })
    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Shared', exact: true })).toBeVisible()
    const previews = frame.getByText('View pending Markdown', { exact: true })
    await expect(previews).toHaveCount(2)
    for (const preview of await previews.all()) await preview.click()
    const drafts = await frame.getByRole('textbox', { name: 'Pending Markdown' }).evaluateAll(areas =>
      areas.map(area => (area as HTMLTextAreaElement).value))
    expect(drafts.sort()).toEqual(['# Shared Folio draft\n\n  **Keep**\n', '# Shared second draft\n\n  **Keep**\n'])
    expect((await read(file)).text).toBe(original)
  })

  test('keeps both conflict versions across reopen and later native changes', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'overlap.md'
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio' })
    await editWhileHeld(page)
    const frame = folio(page)
    await command('insert', { file, offset: '# Shared'.length, text: ' native' })
    await frame.getByRole('heading', { name: 'Shared Folio draft' }).evaluate(() => dispatchEvent(new Event('folio-test-release-edits')))
    await expect(frame.getByText('View VS Code Markdown at recovery', { exact: true })).toBeVisible()
    await command('saveDocument', { file })
    await command('close')
    await command('open', { file, editor: 'native' })
    await command('insert', { file, offset: 2, text: 'Later ' })
    await command('save')
    await command('close')
    await command('open', { file, editor: 'folio' })

    const reopened = folio(page)
    await expect(reopened.getByRole('heading', { name: 'Later Shared native' })).toBeVisible()
    await reopened.getByText('View pending Markdown', { exact: true }).click()
    await reopened.getByText('View VS Code Markdown at recovery', { exact: true }).click()
    await expect(reopened.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue('# Shared Folio draft\n\n  **Keep**\n')
    await expect(reopened.getByRole('textbox', { name: 'VS Code Markdown at recovery' })).toHaveValue('# Shared native\n\n  **Keep**\n')
    expect((await read(file)).text).toBe('# Later Shared native\r\n\r\n  **Keep**\r\n')
  })

  test('keeps a renamed and deleted file’s draft tied to its original URI', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    await writeFile(join(workspace, 'original.md'), original)
    await writeFile(join(workspace, 'other.md'), '# Other\n')
    await command('open', { file: 'original.md', editor: 'folio' })
    await editWhileHeld(page, 'folio-test-hold-all')
    await command('rename', { file: 'original.md', to: 'renamed.md' })
    await command('closeFolio', { file: 'original.md' })
    await command('open', { file: 'renamed.md', editor: 'folio' })
    await expect(folio(page).getByRole('heading', { name: 'Shared', exact: true })).toBeVisible()
    expect((await read('renamed.md')).text).toBe(original)
    await editWhileHeld(page, 'folio-test-hold-all')
    await unlink(join(workspace, 'renamed.md'))
    await command('closeFolio', { file: 'renamed.md' })
    await command('open', { file: 'other.md', editor: 'folio' })
    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Other', exact: true })).toBeVisible()
    await expect(frame.getByText(/\/original\.md$/)).toBeVisible()
    await expect(frame.getByText(/\/renamed\.md$/)).toBeVisible()
    expect((await read('other.md')).text).toBe('# Other\n')
    await writeFile(join(workspace, 'original.md'), '# Replacement at old path\n')
    await command('open', { file: 'original.md', editor: 'folio' })
    await expect(folio(page).getByRole('heading', { name: 'Replacement at old path' })).toBeVisible()
    expect((await read('original.md')).text).toBe('# Replacement at old path\n')
  })

  test('recovers a compact VS Code backup after an extension-host restart', async ({ desktop }) => {
    const { page, workspace, command, read, restart } = desktop
    const file = 'host-restart.md'
    const large = original + 'Retain the rest of this Markdown document.\r\n\r\n'.repeat(1_800)
    await writeFile(join(workspace, file), large)
    await command('open', { file, editor: 'folio' })
    await editWhileHeld(page, 'folio-test-hold-edits', false)
    await expect(folio(page).locator('body')).toHaveAttribute('data-folio-test-stored', '2')
    await expect(folio(page).locator('body')).toHaveAttribute('data-folio-test-packed', '2')
    await restart('host')
    await command('close')
    await command('open', { file, editor: 'folio' })
    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Shared', exact: true })).toBeVisible()
    await frame.getByText('View pending Markdown', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue(large.replace('# Shared', '# Shared Folio draft').replace(/\r\n/g, '\n'))
    expect((await read(file)).text).toBe(large)
  })

  test('recovers from webview storage after reloading the VS Code window', async ({ desktop }) => {
    const { page, workspace, command, read, restart } = desktop
    const file = 'window-reload.md'
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio' })
    await editWhileHeld(page, 'folio-test-hold-all')
    await restart('window')
    await command('open', { file, editor: 'folio' })
    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Shared', exact: true })).toBeVisible()
    await frame.getByText('View pending Markdown', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue('# Shared Folio draft\n\n  **Keep**\n')
    expect((await read(file)).text).toBe(original)
  })
})
